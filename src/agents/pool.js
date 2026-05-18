/**
 * Agent Pool — manages persistent browser tabs (Qwen) or sessions (DeepSeek).
 *
 * Each pooled agent has ONE persistent chat session on the provider's server.
 * Native server memory handles conversation context — no history injection.
 *
 * Usage:
 *   await pool.init(provider, model);
 *   const agent = await pool.acquire();
 *   const result = await pool.run(agent, "your task");
 *   pool.release(agent);
 *   await pool.destroy();
 */

import { connectToChrome } from "../browser/chrome.js";
import { getAuth } from "../auth/store.js";

const POOL_SIZE = 3;

// Injected ONCE on each agent's first message to set its role and output format.
const AGENT_INIT_PROMPT = `You are a WebClaw specialist sub-agent. You will receive focused tasks.
Always end your response with EXACTLY this block (mandatory, no exceptions):

---RESULT---
CONFIDENCE: X/10
NEEDS_MORE: yes|no
SUMMARY: one-line summary of what you found
---END---`;

const ROLES = [
  "Research Specialist — gather information, explore the topic deeply, report all relevant facts.",
  "Analysis Specialist — break down the problem, identify patterns, evaluate tradeoffs logically.",
  "Implementation Specialist — focus on code, concrete solutions, and actionable outputs.",
];

class AgentPool {
  constructor() {
    this.agents = [];
    this.provider = null;
    this.model = null;
    this._ready = false;
  }

  /** Initialize the pool. Opens POOL_SIZE tabs (Qwen) or creates sessions (DeepSeek). */
  async init(provider, model) {
    if (this._ready) return;
    this.provider = provider;
    this.model = model;

    if (provider === "qwen") {
      await this._initQwen();
    } else {
      await this._initDeepseek();
    }

    this._ready = true;
    return this;
  }

  async _initQwen() {
    const { context } = await connectToChrome();
    const auth = getAuth("qwen");

    // Inject cookies once into the shared context
    if (auth?.cookie) {
      const cookies = auth.cookie.split(";").map((c) => {
        const [name, ...rest] = c.trim().split("=");
        return { name: name.trim(), value: rest.join("=").trim(), domain: ".qwen.ai", path: "/" };
      }).filter((c) => c.name && c.value);
      if (cookies.length > 0) await context.addCookies(cookies);
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      const page = await context.newPage();
      await page.goto("https://chat.qwen.ai/", { waitUntil: "domcontentloaded" });

      // Create ONE persistent chat session — reused for this agent's entire lifetime
      const chatId = await page.evaluate(async () => {
        try {
          const res = await fetch("https://chat.qwen.ai/api/v2/chats/new", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const data = await res.json();
          return data.data?.id ?? data.chat_id ?? data.id ?? null;
        } catch { return null; }
      });

      this.agents.push({
        id: i,
        role: ROLES[i % ROLES.length],
        page,
        chatId,
        sessionId: null,
        initialized: false, // true after first message (role injection done)
        busy: false,
      });
    }
  }

  async _initDeepseek() {
    const { createSession } = await import("../providers/deepseek.js");
    const auth = getAuth("deepseek");

    for (let i = 0; i < POOL_SIZE; i++) {
      const sessionId = await createSession(auth);
      this.agents.push({
        id: i,
        role: ROLES[i % ROLES.length],
        page: null,
        chatId: null,
        sessionId,
        initialized: false,
        busy: false,
      });
    }
  }

  /** Acquire a free agent, waiting if all are busy. */
  acquire() {
    if (!this._ready) throw new Error("Pool not initialized. Call pool.init() first.");
    return new Promise((resolve) => {
      const check = () => {
        const agent = this.agents.find((a) => !a.busy);
        if (agent) { agent.busy = true; resolve(agent); }
        else setTimeout(check, 50);
      };
      check();
    });
  }

  /** Release an agent back to the pool. */
  release(agent) {
    agent.busy = false;
  }

  /**
   * Send a task to a specific agent and return its full text response.
   * First call injects the role + output format. Subsequent calls are plain messages.
   * Server-side session memory handles conversation context natively.
   */
  async run(agent, task) {
    const { streamQwenSession } = await import("../providers/qwen.js");
    const { streamDeepseekSession } = await import("../providers/deepseek.js");

    // Build message — inject role on first use only
    const message = !agent.initialized
      ? `${AGENT_INIT_PROMPT}\n\nYour role: ${agent.role}\n\nFirst task: ${task}`
      : task;
    agent.initialized = true;

    let result = "";
    await new Promise((resolve, reject) => {
      const onChunk = (chunk, isThinking) => { if (!isThinking) result += chunk; };
      const onDone = () => resolve();

      if (this.provider === "qwen") {
        streamQwenSession(agent.page, agent.chatId, message, this.model, onChunk, onDone)
          .catch(reject);
      } else {
        streamDeepseekSession(agent.sessionId, message, this.model, onChunk, onDone)
          .catch(reject);
      }
    });

    return result.trim();
  }

  /** Parse the structured result block from an agent's response. */
  parseResult(raw) {
    const block = raw.match(/---RESULT---([\s\S]*?)---END---/);
    if (!block) return { confidence: 5, needsMore: false, summary: raw.slice(0, 200), raw };

    const text = block[1];
    const confidence = parseInt(text.match(/CONFIDENCE:\s*(\d+)/)?.[1] ?? "5", 10);
    const needsMore = /NEEDS_MORE:\s*yes/i.test(text);
    const summary = text.match(/SUMMARY:\s*(.+)/)?.[1]?.trim() ?? "";
    return { confidence, needsMore, summary, raw };
  }

  /** Shut down all pool agents and close their tabs. */
  async destroy() {
    for (const agent of this.agents) {
      if (agent.page) {
        try { await agent.page.close(); } catch { /* ignore */ }
      }
    }
    this.agents = [];
    this._ready = false;
  }
}

// Singleton pool — shared across the process
export const pool = new AgentPool();
