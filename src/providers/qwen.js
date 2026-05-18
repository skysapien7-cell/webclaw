/**
 * Qwen International (chat.qwen.ai) — Streaming Client
 * 
 * Uses Playwright to execute fetch INSIDE Chrome's browser context,
 * which carries the session cookies automatically.
 * This is required because Qwen blocks external API requests.
 * 
 * Derived from openclaw-zero-token qwen-web-client-browser.ts
 */

import { connectToChrome } from "../browser/chrome.js";
import { getAuth, saveAuth } from "../auth/store.js";
import { randomUUID } from "node:crypto";
import { buildContextMessage } from "../history.js";

// Fallback static models if dynamic fetch fails
export const QWEN_MODELS = [
  { id: "qwen-max-latest", name: "Qwen Max (Latest)", description: "Most capable Qwen model" },
  { id: "qwen-plus-latest", name: "Qwen Plus (Latest)", description: "Balanced performance" },
  { id: "qwen-turbo-latest", name: "Qwen Turbo (Latest)", description: "Fast responses" },
  { id: "qwq-32b", name: "QwQ 32B (Reasoning)", description: "Reasoning-focused model" },
];

/**
 * Fetch available models from Qwen API dynamically
 */
export async function fetchQwenModels() {
  try {
    const auth = getAuth("qwen");
    if (!auth) return QWEN_MODELS;

    const { browser, context } = await connectToChrome();
    const pages = context.pages();
    let page = pages.find((p) => p.url().includes("qwen.ai"));
    if (!page) {
      page = await context.newPage();
      await page.goto("https://chat.qwen.ai/", { waitUntil: "domcontentloaded" });
    }

    const data = await page.evaluate(async () => {
      try {
        const r = await fetch("https://chat.qwen.ai/api/models");
        return await r.json();
      } catch (err) {
        return null;
      }
    });

    if (data && data.data && Array.isArray(data.data)) {
      return data.data.map(m => ({
        id: m.id,
        name: m.name,
        description: "Dynamic Qwen model"
      }));
    }
  } catch (e) {
    // Ignore and return fallback
  }
  return QWEN_MODELS;
}

/**
 * Stream a chat response from Qwen International.
 * Runs fetch() INSIDE Chrome's browser context via page.evaluate().
 */
export async function streamQwen(message, model = "qwen-max-latest", onChunk, onDone, history = [], signal) {
  const auth = getAuth("qwen");
  if (!auth) {
    throw new Error("Not logged in to Qwen. Run: webclaw auth qwen");
  }

  // Build the full prompt: system prompt + history + current message
  const contextMessage = buildContextMessage(message, history);

  const { browser, context } = await connectToChrome();

  // Find or create Qwen page
  const pages = context.pages();
  let page = pages.find((p) => p.url().includes("qwen.ai"));
  if (!page) {
    page = await context.newPage();
    await page.goto("https://chat.qwen.ai/", { waitUntil: "domcontentloaded" });
  }

  // Inject cookies
  const cookies = auth.cookie.split(";").map((c) => {
    const [name, ...valueParts] = c.trim().split("=");
    return {
      name: name.trim(),
      value: valueParts.join("=").trim(),
      domain: ".qwen.ai",
      path: "/",
    };
  }).filter(c => c.name && c.value);
  
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  const fid = randomUUID();

  // Step 1: Create a new chat session (inside browser)
  const createResult = await page.evaluate(async ({ baseUrl }) => {
    try {
      const res = await fetch(`${baseUrl}/api/v2/chats/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        return { ok: false, status: res.status, error: await res.text() };
      }
      const data = await res.json();
      const chatId = data.data?.id ?? data.chat_id ?? data.id ?? data.chatId;
      return { ok: true, chatId };
    } catch (err) {
      return { ok: false, status: 500, error: String(err) };
    }
  }, { baseUrl: "https://chat.qwen.ai" });

  if (!createResult.ok || !createResult.chatId) {
    throw new Error(`Failed to create Qwen chat: ${createResult.error || "No chat_id"}`);
  }

  // Step 2: Send message and stream via console interception
  return new Promise((resolve, reject) => {
    let fullText = "";
    let isStreamActive = true;

    const consoleHandler = (msg) => {
      if (!isStreamActive) return;
      const text = msg.text();
      if (text.startsWith(`QWEN_SSE_${fid}::`)) {
        const dataStr = text.slice(`QWEN_SSE_${fid}::`.length).trim();
        if (dataStr === "[DONE]" || !dataStr) return;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta && typeof delta.content === "string") {
            const isThinking = delta.phase === "think";
            if (!isThinking) {
              fullText += delta.content;
            }
            onChunk(delta.content, isThinking);
          }
        } catch {
          // ignore malformed
        }
      }
    };

    page.on("console", consoleHandler);

    page.evaluate(async ({ baseUrl, model, message, fid, chatId }) => {
      try {
        // Single-message format — safe and always accepted by the Qwen web API.
        const res = await fetch(`${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
          body: JSON.stringify({
            stream: true, version: "2.1", incremental_output: true, chat_id: chatId,
            chat_mode: "normal", model: model, parent_id: null,
            messages: [{
              fid, parentId: null, childrenIds: [], role: "user", content: message,
              user_action: "chat", files: [], timestamp: Math.floor(Date.now() / 1000),
              models: [model], chat_type: "t2t",
              feature_config: { thinking_enabled: true, output_schema: "phase" },
            }],
          }),
        });

        if (!res.ok) {
          console.error(`QWEN_ERR_${fid}::${res.status}`);
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              console.log(`QWEN_SSE_${fid}::` + trimmed.slice(5).trim());
            }
          }
        }
      } catch (err) {
        console.error(`QWEN_ERR_${fid}::${err.message}`);
      }
    }, { baseUrl: "https://chat.qwen.ai", model, message: contextMessage, fid, chatId: createResult.chatId })
      .then(() => {
        isStreamActive = false;
        page.off("console", consoleHandler);
        onDone({ fullText });
        resolve();
      })
      .catch((err) => {
        isStreamActive = false;
        page.off("console", consoleHandler);
        reject(err);
      });
  });
}

/**
 * Stream on an already-open page with a persisted chatId.
 * Used by pool agents — no cookie injection, no new session, no history injection.
 * The server's native memory handles the conversation context.
 */
export async function streamQwenSession(page, chatId, message, model, onChunk, onDone) {
  const fid = randomUUID();

  return new Promise((resolve, reject) => {
    let fullText = "";
    let isStreamActive = true;

    const consoleHandler = (msg) => {
      if (!isStreamActive) return;
      const text = msg.text();
      if (text.startsWith(`QWEN_SSE_${fid}::`)) {
        const dataStr = text.slice(`QWEN_SSE_${fid}::`.length).trim();
        if (dataStr === "[DONE]" || !dataStr) return;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta && typeof delta.content === "string") {
            const isThinking = delta.phase === "think";
            if (!isThinking) fullText += delta.content;
            onChunk(delta.content, isThinking);
          }
        } catch { /* ignore */ }
      }
    };

    page.on("console", consoleHandler);

    page.evaluate(async ({ baseUrl, model, message, fid, chatId }) => {
      try {
        const res = await fetch(`${baseUrl}/api/v2/chat/completions?chat_id=${chatId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
          body: JSON.stringify({
            stream: true, version: "2.1", incremental_output: true, chat_id: chatId,
            chat_mode: "normal", model, parent_id: null,
            messages: [{
              fid, parentId: null, childrenIds: [], role: "user", content: message,
              user_action: "chat", files: [], timestamp: Math.floor(Date.now() / 1000),
              models: [model], chat_type: "t2t",
              feature_config: { thinking_enabled: false, output_schema: "phase" },
            }],
          }),
        });
        if (!res.ok) { console.error(`QWEN_ERR_${fid}::${res.status}`); return; }
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) console.log(`QWEN_SSE_${fid}::` + trimmed.slice(5).trim());
          }
        }
      } catch (err) {
        console.error(`QWEN_ERR_${fid}::${err.message}`);
      }
    }, { baseUrl: "https://chat.qwen.ai", model, message, fid, chatId })
      .then(() => {
        isStreamActive = false;
        page.off("console", consoleHandler);
        onDone({ fullText });
        resolve();
      })
      .catch((err) => {
        isStreamActive = false;
        page.off("console", consoleHandler);
        reject(err);
      });
  });
}
