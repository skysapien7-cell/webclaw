/**
 * WebClaw GUI Bridge Server
 *
 * Speaks the WebClaw UI frontend's REST + WebSocket protocol.
 * Bridges the React UI to webclaw's Qwen/DeepSeek providers.
 *
 * REST:  http://localhost:8324/api/...
 * WS:    ws://localhost:8324/ws/session/:id
 */

import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { streamQwen, QWEN_MODELS } from "./src/providers/qwen.js";
import { streamDeepseek, DEEPSEEK_MODELS } from "./src/providers/deepseek.js";
import { getAuth } from "./src/auth/store.js";
import { runOrchestrator } from "./src/agents/orchestrator.js";
import { buildContextMessage } from "./src/history.js";
import { runAgentLoop } from "./src/agents/loop.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8324;

// ── In-memory state ──────────────────────────────────────────────────────────
const sessions = new Map();      // id → session object
const dashboards = new Map();    // id → dashboard object
const sessionWs = new Map();     // sessionId → WebSocket

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(opts = {}) {
  const id = randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    name: opts.name || "New Chat",
    status: "idle",
    model: opts.model || "qwen",
    messages: [],
    created_at: now,
    updated_at: now,
    dashboard_id: opts.dashboard_id || null,
    mode: "chat",
  };
}

function makeDashboard(name = "My Dashboard") {
  const id = randomUUID();
  const now = new Date().toISOString();
  const dash = { id, name, created_at: now, updated_at: now };
  dashboards.set(id, dash);
  return dash;
}

// Auto-create a default dashboard on startup
const defaultDash = makeDashboard("My Dashboard");

/** Resolve provider + model ID from the frontend model string. */
function resolveModel(modelStr) {
  if (!modelStr) return { provider: "qwen", modelId: "qwen2.5-max" };
  const s = String(modelStr).toLowerCase();
  if (s.includes("deepseek")) return { provider: "deepseek", modelId: s };
  return { provider: "qwen", modelId: s };
}

/** Send a typed WS event to the session's connected client. */
function sendWs(sessionId, event, data, seq) {
  const ws = sessionWs.get(sessionId);
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ event, session_id: sessionId, data, seq }));
}

/** Stream a chat message through the correct provider, firing WS events. */
async function streamMessage(session, userText) {
  const msgId = randomUUID();
  let seq = 1;
  let fullText = "";

  session.status = "running";
  sendWs(session.id, "agent:status", { status: "running" }, seq++);
  sendWs(session.id, "agent:stream_start", { message_id: msgId, role: "assistant" }, seq++);

  // Custom history callbacks to store history in this specific session
  let assistantPushedCount = 0;
  const loopOptions = {
    getHistory: () => session.messages.map((m) => ({ role: m.role, content: m.content })),
    pushUser: (content) => {
      session.messages.push({
        id: randomUUID(),
        role: "user",
        content,
        created_at: new Date().toISOString(),
      });
    },
    pushAssistant: (content) => {
      session.messages.push({
        id: assistantPushedCount === 0 ? msgId : randomUUID(),
        role: "assistant",
        content,
        created_at: new Date().toISOString(),
      });
      assistantPushedCount++;
    },
  };

  const onChunk = (chunk, isThinking) => {
    if (isThinking) return;
    fullText += chunk;
    sendWs(session.id, "agent:stream_delta", { message_id: msgId, delta: chunk }, seq++);
  };

  const onConfirm = async (tool, args) => {
    // Notify the user in the streaming bubble that a tool is being executed
    let note = `\n\n⚙️ **Running tool:** \`${tool}\``;
    if (args.path) note += ` on \`${args.path}\``;
    if (args.command) note += `: \`${args.command}\``;
    note += `...\n`;
    
    sendWs(session.id, "agent:stream_delta", { message_id: msgId, delta: note }, seq++);
    return true; // Auto-approve in GUI mode
  };

  try {
    const { provider, modelId } = resolveModel(session.model);
    const result = await runAgentLoop(userText, modelId, provider, loopOptions, onChunk, onConfirm);
    fullText = result;
  } catch (err) {
    fullText = `Error: ${err.message}`;
    sendWs(session.id, "agent:stream_delta", { message_id: msgId, delta: `\n\n❌ **Error:** ${err.message}` }, seq++);
  }

  sendWs(session.id, "agent:stream_end", { message_id: msgId }, seq++);

  session.status = "idle";
  session.updated_at = new Date().toISOString();

  sendWs(session.id, "agent:status", { status: "completed", session }, seq++);
}

/** Run multi-agent orchestration, streaming header + final answer via WS. */
async function runAgentMode(session, task) {
  const msgId = randomUUID();
  let seq = 1;
  let fullText = "";

  session.status = "running";
  sendWs(session.id, "agent:status", { status: "running" }, seq++);

  const onHeader = (text) => {
    const chunk = `\n${text}\n`;
    fullText += chunk;
    sendWs(session.id, "agent:stream_delta", { message_id: msgId, delta: chunk }, seq++);
  };

  const onChunk = (chunk, isThinking) => {
    if (isThinking) return;
    fullText += chunk;
    sendWs(session.id, "agent:stream_delta", { message_id: msgId, delta: chunk }, seq++);
  };

  sendWs(session.id, "agent:stream_start", { message_id: msgId, role: "assistant" }, seq++);

  try {
    const { provider, modelId } = resolveModel(session.model);
    await runOrchestrator(task, provider, modelId, onHeader, onChunk, () => {});
  } catch (err) {
    onChunk(`\nAgent error: ${err.message}`, false);
  }

  sendWs(session.id, "agent:stream_end", { message_id: msgId }, seq++);

  const assistantMsg = { id: msgId, role: "assistant", content: fullText, created_at: new Date().toISOString() };
  session.messages.push(assistantMsg);
  session.status = "idle";
  session.updated_at = new Date().toISOString();
  sendWs(session.id, "agent:status", { status: "completed", session }, seq++);
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// ── REST: Settings ────────────────────────────────────────────────────────────
app.get("/api/settings", (req, res) => {
  res.json({ 
    theme: "dark", 
    default_model: "qwen2.5-max",
    new_agent_shortcut: "Meta+l",
    default_mode: "agent",
    default_thinking_level: "auto",
    zoom_sensitivity: 50,
    browser_homepage: "https://www.google.com",
    auto_reveal_sub_agents: true
  });
});
app.patch("/api/settings", (req, res) => res.json({ ok: true }));

// ── REST: Auth / subscription stubs ──────────────────────────────────────────
app.get("/api/auth/identity-status", (req, res) => {
  res.json({ authed: true, hard_gate: false });
});
app.post("/api/subscription/sync", (req, res) => res.json({ ok: true }));
app.post("/api/service/submit", (req, res) => res.json({ ok: true }));

// ── REST: Models ──────────────────────────────────────────────────────────────
app.get("/api/agents/models", (req, res) => {
  const qwenAuthed = !!getAuth("qwen");
  const dsAuthed = !!getAuth("deepseek");
  const models = [];

  if (qwenAuthed) {
    for (const m of QWEN_MODELS) {
      models.push({ value: m.id, label: m.name, provider: "WebClaw/Qwen" });
    }
  }
  if (dsAuthed) {
    for (const m of DEEPSEEK_MODELS) {
      models.push({ value: m.id, label: m.name, provider: "WebClaw/DeepSeek" });
    }
  }
  // Group by provider for the frontend's byProvider selector
  const byProvider = {};
  for (const m of models) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  }
  res.json({ models, byProvider });
});

// ── REST: Sessions ────────────────────────────────────────────────────────────
app.get("/api/agents/sessions", (req, res) => {
  res.json({ sessions: [...sessions.values()] });
});

app.get("/api/agents/sessions/:id", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  res.json({ session: s });
});

// Launch a new session ("create + start" endpoint)
app.post("/api/agents/launch", (req, res) => {
  const { model, name, dashboard_id, initial_message } = req.body || {};
  const session = makeSession({ model, name, dashboard_id });
  sessions.set(session.id, session);

  // Store initial_message — it will be sent when the WS connects
  if (initial_message) session._pendingMessage = initial_message;

  res.json({ session });
});

// Send a message to an existing session
app.post("/api/agents/sessions/:id/message", async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: "not found" });

  const { content, mode } = req.body || {};

  // Push user message
  const userMsg = { id: randomUUID(), role: "user", content, created_at: new Date().toISOString() };
  session.messages.push(userMsg);
  session.updated_at = new Date().toISOString();

  // Respond immediately — streaming happens via WS
  res.json({ message: userMsg });

  // Stream asynchronously
  if (mode === "agent") {
    runAgentMode(session, content).catch(console.error);
  } else {
    streamMessage(session, content).catch(console.error);
  }
});

app.post("/api/agents/sessions/:id/stop", (req, res) => {
  const s = sessions.get(req.params.id);
  if (s) { s.status = "stopped"; s.updated_at = new Date().toISOString(); }
  res.json({ ok: true });
});

app.post("/api/agents/sessions/:id/close", (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

app.delete("/api/agents/sessions/:id", (req, res) => {
  sessions.delete(req.params.id);
  res.json({ ok: true });
});

// Generate title stub (model will handle it, we just return a placeholder)
app.post("/api/agents/sessions/:id/generate-title", async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "not found" });
  const firstUser = s.messages.find((m) => m.role === "user");
  const title = firstUser ? firstUser.content.slice(0, 40) : "New Chat";
  s.name = title;
  res.json({ name: title });
});

// History search (return recent sessions)
app.get("/api/agents/history", (req, res) => {
  const items = [...sessions.values()].slice(-50).reverse();
  res.json({ sessions: items, total: items.length });
});

// ── REST: Dashboards ──────────────────────────────────────────────────────────
app.get("/api/dashboards/list", (req, res) => {
  res.json({ dashboards: [...dashboards.values()] });
});

app.post("/api/dashboards/create", (req, res) => {
  const dash = makeDashboard(req.body?.name || "New Dashboard");
  res.json({ dashboard: dash });
});

app.get("/api/dashboards/:id", (req, res) => {
  const d = dashboards.get(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  // Return sessions for this dashboard
  const dashSessions = [...sessions.values()].filter((s) => s.dashboard_id === req.params.id);
  res.json({ dashboard: d, sessions: dashSessions, browser_cards: [] });
});

app.patch("/api/dashboards/:id", (req, res) => {
  const d = dashboards.get(req.params.id);
  if (!d) return res.status(404).json({ error: "not found" });
  Object.assign(d, req.body, { updated_at: new Date().toISOString() });
  res.json({ dashboard: d });
});

app.delete("/api/dashboards/:id", (req, res) => {
  dashboards.delete(req.params.id);
  res.json({ ok: true });
});

app.post("/api/dashboards/:id/generate-name", (req, res) => {
  const d = dashboards.get(req.params.id);
  res.json({ name: d?.name || "Dashboard" });
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  // URL: /ws/session/:id  or  /ws/dashboard/:id
  const parts = req.url?.split("?")[0].split("/").filter(Boolean);
  // parts = ['ws', 'session', ':id'] or ['ws', 'dashboard', ':id']
  const type = parts[1]; // 'session' | 'dashboard'
  const id = parts[2];

  if (type === "session" && id) {
    sessionWs.set(id, ws);

    // Resume handshake
    let seq = 1;
    ws.send(JSON.stringify({ event: "server:hello", session_id: id, data: {}, seq: seq++ }));

    // If there's a pending initial message, stream it now
    const session = sessions.get(id);
    if (session?._pendingMessage) {
      const pending = session._pendingMessage;
      delete session._pendingMessage;
      const userMsg = { id: randomUUID(), role: "user", content: pending, created_at: new Date().toISOString() };
      session.messages.push(userMsg);
      streamMessage(session, pending).catch(console.error);
    }

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "client:ping") {
          ws.send(JSON.stringify({ event: "server:pong", data: { nonce: msg.data?.nonce } }));
        }
        // client:hello just triggers the resume ack (already sent above)
      } catch { /* ignore malformed */ }
    });

    ws.on("close", () => sessionWs.delete(id));
  } else {
    // Dashboard WS — send hello and handle pings only
    ws.send(JSON.stringify({ event: "server:hello", data: {} }));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.event === "client:ping") {
          ws.send(JSON.stringify({ event: "server:pong", data: { nonce: msg.data?.nonce } }));
        }
      } catch { /* ignore */ }
    });
  }
});

server.listen(PORT, () => {
  console.log(`\x1b[32m✓\x1b[0m WebClaw GUI Server running`);
  console.log(`  \x1b[36mAPI:\x1b[0m   http://localhost:${PORT}/api`);
  console.log(`  \x1b[36mWS:\x1b[0m    ws://localhost:${PORT}/ws/session/:id\n`);
});
