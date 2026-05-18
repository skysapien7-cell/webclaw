/**
 * Orchestrator — coordinates parallel sub-agents to answer complex tasks.
 *
 * Flow:
 *   1. Decompose: ask main model to split task into ≤3 sub-tasks (JSON array)
 *   2. Dispatch: run each sub-task on a pool agent in parallel
 *      - Each agent shows a live spinner + heartbeat, no text leaks
 *   3. Evaluate: check confidence scores — done or follow-up?
 *   4. Follow-up: same agents, they remember prior context via server memory
 *   5. Synthesize: stream final answer to the user
 */

import { pool } from "./pool.js";
import { AgentStatusDisplay } from "./status.js";
import { buildContextMessage } from "../history.js";
import { streamQwen } from "../providers/qwen.js";
import { streamDeepseek } from "../providers/deepseek.js";

const MAX_ROUNDS = 3;
const CONFIDENCE_THRESHOLD = 6;

/** Make a one-off stateless model call and collect the full response. */
async function queryModel(prompt, provider, model) {
  let result = "";
  const onChunk = (chunk, isThinking) => { if (!isThinking) result += chunk; };
  const onDone = () => {};
  if (provider === "qwen") await streamQwen(prompt, model, onChunk, onDone, []);
  else await streamDeepseek(prompt, model, onChunk, onDone, []);
  return result.trim();
}

/** Ask model to decompose task into ≤3 sub-tasks. Returns string[]. */
async function decompose(task, provider, model) {
  const prompt = buildContextMessage(
    `You are a task coordinator. Break this task into at most 3 focused sub-tasks for specialist agents.
Reply with ONLY a valid JSON array of strings, nothing else.

Task: ${task}`, []
  );
  const raw = await queryModel(prompt, provider, model);
  const match = raw.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const tasks = JSON.parse(match[0]);
      if (Array.isArray(tasks) && tasks.every((t) => typeof t === "string")) return tasks.slice(0, 3);
    } catch { /* fall through */ }
  }
  return [task]; // Fallback: treat entire task as one sub-task
}

/**
 * Main orchestrator entry point.
 *
 * @param {string} task         User's complex task
 * @param {string} provider     "qwen" | "deepseek"
 * @param {string} model        Model ID
 * @param {Function} onHeader   fn(text) — print a bold header line
 * @param {Function} onChunk    fn(chunk, isThinking) — final answer streaming
 * @param {Function} onDone     fn({fullText}) — called when complete
 */
export async function runOrchestrator(task, provider, model, onHeader, onChunk, onDone) {
  await pool.init(provider, model);

  // ── Step 1: Decompose ────────────────────────────────────────────────────
  onHeader("🔍 Decomposing task...");
  const subTasks = await decompose(task, provider, model);
  onHeader(`📋 ${subTasks.length} sub-task(s) identified — acquiring agents...`);

  // ── Step 2: Acquire agents ────────────────────────────────────────────────
  const slots = await Promise.all(
    subTasks.map(async (t, i) => ({
      index: i,
      task: t,
      agent: await pool.acquire(),
      results: [],
      done: false,
    }))
  );

  // ── Step 3: Build status display ──────────────────────────────────────────
  const display = new AgentStatusDisplay(slots.map((s) => s.agent));
  display.start();

  try {
    let round = 0;

    while (round < MAX_ROUNDS) {
      round++;
      const active = slots.filter((s) => !s.done);
      if (active.length === 0) break;

      // Update status to show new round
      for (const s of active) {
        display.setStatus(s.agent.id, round === 1 ? "researching task..." : "digging deeper...");
      }

      // ── Run all active agents in parallel ──────────────────────────────
      await Promise.all(
        active.map(async (slot) => {
          // Heartbeat: cycle status text every few seconds while waiting
          let tick = 0;
          const HEARTBEATS = ["researching...", "analyzing...", "writing report...", "cross-checking..."];
          const hbTimer = setInterval(() => {
            tick++;
            if (!slot.done) display.setStatus(slot.agent.id, HEARTBEATS[tick % HEARTBEATS.length]);
          }, 2500);

          try {
            const raw = await pool.run(slot.agent, slot.task);
            const parsed = pool.parseResult(raw);
            slot.results.push(parsed);

            // Mark done in display
            const conf = parsed.confidence;
            const color = conf >= 7 ? "\x1b[32m" : conf >= 5 ? "\x1b[33m" : "\x1b[31m";
            display.setDone(
              slot.agent.id,
              `${color}confidence ${conf}/10\x1b[0m — ${parsed.summary || "done"}`
            );

            // Decide if follow-up needed
            if (!parsed.needsMore || conf >= CONFIDENCE_THRESHOLD || round >= MAX_ROUNDS) {
              slot.done = true;
              slot.task = null;
            } else {
              slot.task = `Continue your research. You previously found: ${parsed.summary}. Go deeper.`;
            }
          } finally {
            clearInterval(hbTimer);
          }
        })
      );
    }

    // ── Stop display ───────────────────────────────────────────────────────
    display.stop();

    // ── Step 4: Synthesize ────────────────────────────────────────────────
    onHeader("✨ Synthesizing final answer...");

    const allResults = slots.flatMap((s) => s.results);
    const findings = allResults
      .map((r, i) => `Agent ${i + 1} finding:\n${r.raw}`)
      .join("\n\n---\n\n");

    const synthesisPrompt = buildContextMessage(
      `You are summarizing research from specialist agents.
Original task: ${task}

Findings:
${findings}

Write a complete, well-structured answer. Do not mention agents or the research process — just give the answer directly.`, []
    );

    if (provider === "qwen") await streamQwen(synthesisPrompt, model, onChunk, onDone, []);
    else await streamDeepseek(synthesisPrompt, model, onChunk, onDone, []);

  } finally {
    display.stop(); // Safety: stop if we errored mid-run
    for (const slot of slots) pool.release(slot.agent);
  }
}
