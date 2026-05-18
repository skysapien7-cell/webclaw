/**
 * webclaw agent "your complex task"
 *
 * Runs a multi-agent workflow:
 *   - Decomposes the task into sub-tasks
 *   - Runs each sub-task on a dedicated pooled browser tab
 *   - Each tab has genuine server-side memory (no history injection)
 *   - Agents run in parallel, report confidence scores
 *   - Orchestrator decides when to continue or synthesize
 *   - Streams the final answer to the terminal
 */

import { runOrchestrator } from "../agents/orchestrator.js";
import { pool } from "../agents/pool.js";
import { getAuth } from "../auth/store.js";
import { success, error, info, warn } from "../ui/banner.js";
import { resolveProvider, getAllModels } from "../providers/resolve.js";

export const agentCommand = {
  command: "agent <task>",
  describe: "Run a multi-agent task with parallel specialist sub-agents",
  builder: (yargs) =>
    yargs
      .positional("task", {
        describe: "The complex task to solve",
        type: "string",
      })
      .option("model", {
        alias: "m",
        describe: "Model to use for all agents",
        type: "string",
        default: "qwen-max-latest",
      })
      .option("agents", {
        alias: "n",
        describe: "Number of parallel sub-agents (max 3)",
        type: "number",
        default: 3,
      }),

  handler: async (argv) => {
    const { task, model: modelId } = argv;

    // Resolve provider from model ID
    const provider = await resolveProvider(modelId);
    if (!provider) {
      error(`Unknown model: ${modelId}`);
      const models = await getAllModels();
      info("Available models:");
      for (const m of models) info(`  ${m.id} — ${m.name}`);
      process.exit(1);
    }

    // Check auth
    const auth = getAuth(provider);
    if (!auth) {
      error(`Not authenticated with ${provider}. Run: webclaw auth ${provider}`);
      process.exit(1);
    }

    info(`\x1b[1mWebClaw Multi-Agent\x1b[0m`);
    info(`Model: ${modelId} (${provider})`);
    info(`Task: ${task}`);
    console.log("");

    let charCount = 0;
    let startTime = null;

    const onStatus = (msg) => {
      process.stdout.write(`\x1b[2m${msg}\x1b[0m\n`);
    };

    const onChunk = (chunk, isThinking) => {
      if (isThinking) return; // sub-agents handle their own thinking silently
      if (!startTime) {
        startTime = Date.now();
        console.log("");
        process.stdout.write("\x1b[33m⟡\x1b[0m ");
      }
      process.stdout.write(chunk);
      charCount += chunk.length;
    };

    const onDone = ({ fullText, thinkingText }) => {
      const elapsed = startTime
        ? ((Date.now() - startTime) / 1000).toFixed(1)
        : "0.0";
      console.log("");
      console.log(`\x1b[2m── ${charCount} chars · ${elapsed}s\x1b[0m`);
    };

    try {
      await runOrchestrator(task, provider, modelId, onStatus, onChunk, onDone);
    } catch (e) {
      console.log("");
      error(e.message);
    } finally {
      // Pool tabs stay open for re-use within the session.
      // They'll be cleaned up when the process exits.
      process.stdout.write("\x1b[?25h"); // ensure cursor is visible
    }
  },
};
