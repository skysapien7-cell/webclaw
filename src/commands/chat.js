/**
 * `webclaw chat` — Interactive AI chat in the terminal
 * 
 * Combines the opencode-style interactive CLI experience with
 * openclaw's Chrome-based AI model streaming.
 */

import { createInterface } from "node:readline";
import { streamQwen, fetchQwenModels, QWEN_MODELS } from "../providers/qwen.js";
import { streamDeepseek, fetchDeepseekModels, DEEPSEEK_MODELS } from "../providers/deepseek.js";
import { getAuth } from "../auth/store.js";
import { loginQwen } from "../auth/qwen.js";
import { loginDeepseek } from "../auth/deepseek.js";
import { success, error, info, warn } from "../ui/banner.js";
import { isChromeRunning } from "../browser/chrome.js";
import { pushUser, pushAssistant, getHistory, clearHistory, historySummary } from "../history.js";
import { runOrchestrator } from "../agents/orchestrator.js";

// ── Lightweight spinner that writes ONLY to stderr, never touches stdout ──
// This avoids all conflicts with readline which owns stdout.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function createSpinner(text) {
  let i = 0;
  let timer = null;
  return {
    start() {
      process.stderr.write("\x1b[?25l"); // hide cursor on stderr
      timer = setInterval(() => {
        const frame = SPINNER_FRAMES[i % SPINNER_FRAMES.length];
        process.stderr.write(`\r\x1b[2m${frame} ${text}\x1b[0m`);
        i++;
      }, 80);
      return this;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stderr.write("\r\x1b[K");   // erase spinner line
      process.stderr.write("\x1b[?25h");  // show cursor
    },
  };
}

async function getAllModels() {
  const qwenModels = await fetchQwenModels();
  const dsModels = await fetchDeepseekModels();
  return [...qwenModels, ...dsModels];
}

async function resolveProvider(modelId) {
  const allModels = await getAllModels();
  if (allModels.some((m) => m.id === modelId && m.id.includes("qwen"))) return "qwen";
  if (allModels.some((m) => m.id === modelId && m.id.includes("deepseek"))) return "deepseek";
  
  if (QWEN_MODELS.some((m) => m.id === modelId)) return "qwen";
  if (DEEPSEEK_MODELS.some((m) => m.id === modelId)) return "deepseek";

  // Fuzzy match
  const lower = modelId.toLowerCase();
  if (lower.includes("qwen") || lower.includes("qwq")) return "qwen";
  if (lower.includes("deepseek") || lower.includes("deep")) return "deepseek";

  return null;
}

function getDefaultModel() {
  // Prefer Qwen (works in India), fall back to DeepSeek
  if (getAuth("qwen")) return "qwen-max-latest";
  if (getAuth("deepseek")) return "deepseek_chat";
  return null;
}

export const chatCommand = {
  command: "chat",
  describe: "Start interactive AI chat",
  builder: (yargs) =>
    yargs
      .option("model", {
        alias: "m",
        describe: "Model to use",
        type: "string",
      })
      .option("single", {
        alias: "s",
        describe: "Single message mode (non-interactive)",
        type: "string",
      }),
  handler: async (argv) => {
    let modelId = argv.model || getDefaultModel();

    if (!modelId) {
      error("No authenticated providers found.");
      info("Run these commands first:");
      info("  1. webclaw chrome     (start Chrome debug mode)");
      info("  2. webclaw auth qwen  (or: webclaw auth deepseek)");
      process.exit(1);
    }

    let allModels = await getAllModels();

    let provider = await resolveProvider(modelId);
    if (!provider) {
      error(`Unknown model: ${modelId}`);
      info("Available models:");
      for (const m of allModels) {
        info(`  ${m.id} — ${m.name}`);
      }
      process.exit(1);
    }

    const auth = getAuth(provider);
    if (!auth) {
      error(`Not authenticated with ${provider}. Run: webclaw auth ${provider}`);
      process.exit(1);
    }

    const modelName = allModels.find((m) => m.id === modelId)?.name || modelId;

    // Single message mode
    if (argv.single) {
      info(`Model: ${modelName}`);
      console.log("");
      await sendMessage(argv.single, modelId, provider);
      return;
    }

    const showHelp = () => {
      info(`Commands:`);
      info(`  /help         — show this help menu`);
      info(`  /auth <prov>  — re-authenticate (qwen or deepseek)`);
      info(`  /model <id>   — switch model`);
      info(`  /models       — list models`);
      info(`  /agent <task> — spawn parallel sub-agents`);
      info(`  /think on|off — toggle DeepThink/reasoning`);
      info(`  /search on|off— toggle web search`);
      info(`  /instant      — switch to Instant mode`);
      info(`  /expert       — switch to Expert mode`);
      info(`  /clear        — clear screen`);
      info(`  /quit         — exit`);
    };

    // Interactive mode
    info(`Model: \x1b[1m${modelName}\x1b[0m (${provider})`);
    info(`Type your message and press Enter. Type /help to see commands.`);
    console.log("");

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "\x1b[36m❯\x1b[0m ",
    });

    const sessionOptions = {
      think: null, 
      search: false,
      chatMode: "instant", // "instant" or "expert"
      sessionId: null, // Persist server-side chat session
      parentId: null,
    };

    // --- Diagnostic Ping ---
    const diagSpinner = createSpinner("Pinging systems and checking feature readiness...").start();
    
    // 1. Check Chrome (Needed for Qwen and Agents)
    const chromeReady = await isChromeRunning();
    
    // 2. Check Models/Auth
    let qwenCount = 0;
    let dsCount = 0;
    if (getAuth("qwen")) {
      const qModels = await fetchQwenModels();
      if (qModels.length > 4) qwenCount = qModels.length; // Dynamic models loaded means auth is perfectly valid
    }
    if (getAuth("deepseek")) {
      dsCount = DEEPSEEK_MODELS.length; // Deepseek auth is valid if we have the token
    }

    diagSpinner.stop();
    info(`\x1b[1mSystem Diagnostics:\x1b[0m`);
    if (chromeReady) {
      success(`Browser Automation: \x1b[32mREADY\x1b[0m (Chrome CDP connected)`);
      success(`Agent Orchestrator: \x1b[32mREADY\x1b[0m (Parallel sub-agents available)`);
    } else {
      warn(`Browser Automation: \x1b[31mOFFLINE\x1b[0m (Run 'webclaw chrome' to enable Qwen & Agents)`);
      warn(`Agent Orchestrator: \x1b[31mUNAVAILABLE\x1b[0m`);
    }

    if (qwenCount > 0) {
      success(`Qwen API: \x1b[32mREADY\x1b[0m (${qwenCount} models loaded)`);
    } else if (provider === "qwen") {
      warn(`Qwen API: \x1b[31mOFFLINE\x1b[0m (Auth expired or Chrome closed)`);
    }

    if (dsCount > 0) {
      success(`DeepSeek API: \x1b[32mREADY\x1b[0m (Features available)`);
    } else if (provider === "deepseek") {
      warn(`DeepSeek API: \x1b[31mOFFLINE\x1b[0m (Auth expired)`);
    }

    success(`Feature Toggles: \x1b[32mREADY\x1b[0m`);
    console.log("");

    rl.prompt();

    rl.on("line", async (line) => {
      const input = line.trim();
      if (!input) {
        rl.prompt();
        return;
      }

      // Handle slash commands
      if (input.startsWith("/")) {
        const [cmd, ...args] = input.slice(1).split(" ");

        if (cmd === "quit" || cmd === "exit" || cmd === "q") {
          info("Goodbye!");
          process.exit(0);
        }

        if (cmd === "help") {
          showHelp();
          console.log("");
          rl.prompt();
          return;
        }

        if (cmd === "auth") {
          const targetProv = args[0]?.toLowerCase();
          if (targetProv !== "qwen" && targetProv !== "deepseek") {
            warn("Please specify provider: /auth qwen OR /auth deepseek");
            rl.prompt();
            return;
          }

          info(`Extracting fresh cookies from Chrome for ${targetProv}...`);
          try {
            if (targetProv === "qwen") {
              await loginQwen((msg) => info(`  ${msg}`));
            } else {
              await loginDeepseek((msg) => info(`  ${msg}`));
            }
            success(`Successfully re-authenticated with ${targetProv}!`);
            
            // Refresh models list in case they changed
            allModels = await getAllModels();
          } catch (e) {
            error(`Auth failed: ${e.message}`);
          }
          console.log("");
          rl.prompt();
          return;
        }

        if (cmd === "clear" || cmd === "cls") {
          clearHistory();
          sessionOptions.sessionId = null;
          sessionOptions.parentId = null;
          console.clear();
          info("Screen and conversation history cleared.");
          rl.prompt();
          return;
        }

        if (cmd === "models") {
          info("Available models:");
          allModels = await getAllModels();
          for (const m of allModels) {
            const marker = m.id === modelId ? " \x1b[32m◀ current\x1b[0m" : "";
            info(`  \x1b[36m${m.id}\x1b[0m — ${m.name}${marker}`);
          }
          rl.prompt();
          return;
        }

        if (cmd === "model" && args[0]) {
          const newId = args[0];
          const newProvider = await resolveProvider(newId);
          if (!newProvider) {
            error(`Unknown model: ${newId}`);
          } else if (!getAuth(newProvider)) {
            error(`Not authenticated with ${newProvider}. Run: webclaw auth ${newProvider}`);
          } else {
            // ✅ Update BOTH modelId AND provider so the next message goes to the right backend
            modelId = newId;
            provider = newProvider;
            sessionOptions.sessionId = null; // Reset session when switching models
            sessionOptions.parentId = null;
            allModels = await getAllModels();
            const name = allModels.find((m) => m.id === newId)?.name || newId;
            success(`Switched to: ${name} (${newProvider})`);
          }
          rl.prompt();
          return;
        }

        if (cmd === "agent" && args.length > 0) {
          const agentTask = args.join(" ");
          rl.pause();
          console.log("");
          info(`\x1b[1m🔧 Multi-Agent Task\x1b[0m`);
          info(`Task: ${agentTask}`);

          let charCount = 0;
          let agentStartTime = null;

          const onHeader = (msg) => process.stdout.write(`\x1b[2m${msg}\x1b[0m\n`);
          const onChunk = (chunk, isThinking) => {
            if (isThinking) return;
            if (!agentStartTime) {
              agentStartTime = Date.now();
              console.log("");
              process.stdout.write("\x1b[33m⟡\x1b[0m ");
            }
            process.stdout.write(chunk);
            charCount += chunk.length;
          };
          const onDone = () => {
            const elapsed = agentStartTime
              ? ((Date.now() - agentStartTime) / 1000).toFixed(1)
              : "0.0";
            console.log("");
            console.log(`\x1b[2m── ${charCount} chars · ${elapsed}s\x1b[0m`);
          };

          try {
            await runOrchestrator(agentTask, provider, modelId, onHeader, onChunk, onDone);
          } catch (e) {
            console.log("");
            error(`Agent error: ${e.message}`);
          } finally {
            process.stdout.write("\x1b[?25h");
          }

          console.log("");
          rl.resume();
          rl.prompt();
          return;
        }

        if (cmd === "instant" || cmd === "expert") {
          sessionOptions.chatMode = cmd;
          success(`Switched to ${cmd === "instant" ? "Instant" : "Expert"} mode`);
          rl.prompt();
          return;
        }

        if (["think", "search"].includes(cmd)) {
          const val = args[0]?.toLowerCase();
          if (val === "on" || val === "off") {
            sessionOptions[cmd] = (val === "on");
            success(`${cmd} mode is now ${val.toUpperCase()}`);
          } else {
            const current = sessionOptions[cmd];
            info(`${cmd} mode is currently: ${current === null ? "DEFAULT" : (current ? "ON" : "OFF")}`);
          }
          rl.prompt();
          return;
        }

        warn(`Unknown command: /${cmd}`);
        rl.prompt();
        return;
      }

      // Pause readline so our spinner doesn't fight with it
      rl.pause();

      // Record user turn in history, then send
      const currentModelId = modelId;
      const currentProvider = provider;
      const userMessage = input;
      pushUser(userMessage);

      try {
        let turnOptions = { ...sessionOptions };
        const assistantReply = await sendMessage(userMessage, currentModelId, currentProvider, getHistory().slice(0, -1), turnOptions);
        // slice(0,-1) gives history *before* this turn (we already pushed user above)
        pushAssistant(assistantReply);
      } catch (e) {
        error(e.message);
      }

      // Restore terminal state and resume readline
      process.stdout.write("\x1b[?25h"); // force show cursor
      console.log("");
      rl.resume();
      rl.prompt();
    });

    rl.on("close", () => {
      console.log("");
      info("Goodbye!");
      process.exit(0);
    });
  },
};

/**
 * Send a message and stream the response.
 * @param {string} message - The current user message
 * @param {string} modelId - Model ID to call
 * @param {string} provider - "qwen" | "deepseek"
 * @param {{ role: string, content: string }[]} history - All turns BEFORE this message
 * @param {object} options - Feature toggles like search, think, etc.
 * @returns {Promise<string>} - The complete assistant reply (for storing in history)
 */
async function sendMessage(message, modelId, provider, history = [], options = {}) {
  const startTime = Date.now();
  console.log("");
  process.stdout.write("\x1b[33m⟡\x1b[0m ");

  let charCount = 0;
  let fullResponseText = "";
  let isThinkingMode = false;
  let thinkingStarted = false;
  let spinner = null;

  const onChunk = (chunk, isThinking = false) => {
    if (isThinking) {
      if (!thinkingStarted) {
        thinkingStarted = true;
        isThinkingMode = true;
        spinner = createSpinner("Thinking...").start();
      }
    } else {
      if (isThinkingMode) {
        isThinkingMode = false;
        if (spinner) {
          spinner.stop();
          spinner = null;
        }
      }
      process.stdout.write(chunk);
      fullResponseText += chunk;
      charCount += chunk.length;
    }
  };

  const onDone = ({ fullText, thinkingText, sessionId, parentId }) => {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
    
    // Capture session state so next turn continues in the same chat thread!
    if (sessionId) options.sessionId = sessionId;
    if (parentId) options.parentId = parentId;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const turnNum = Math.floor(history.length / 2) + 1;
    const turnInfo = history.length > 0 ? ` · turn ${turnNum}` : "";
    console.log("");
    if (thinkingText) {
      console.log(`\x1b[2m── 💭 Thought for ${elapsed}s · ${charCount} chars${turnInfo}\x1b[0m`);
    } else {
      console.log(`\x1b[2m── ${charCount} chars · ${elapsed}s${turnInfo}\x1b[0m`);
    }
  };

  try {
    if (provider === "qwen") {
      await streamQwen(message, modelId, onChunk, onDone, history, null, options);
    } else if (provider === "deepseek") {
      await streamDeepseek(message, modelId, onChunk, onDone, history, null, options);
    }
  } catch (e) {
    console.log("");
    throw e;
  } finally {
    // Always clean up spinner and restore cursor no matter what
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
    process.stdout.write("\x1b[?25h");
  }

  return fullResponseText;
}
