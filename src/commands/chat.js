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
import { runAgentLoop } from "../agents/loop.js";

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

    const cliState = {
      modelId: modelId,
      modelName: modelName,
      provider: provider,
      think: null, 
      search: false,
      chatMode: "instant", // "instant" or "expert"
      sessionId: null, // Persist server-side chat session
      parentId: null,
      streamingSpeed: 0,
      isStreaming: false,
      tokenCount: 0,
      showStatusBar: true,
      currentAction: "idle",  // "idle", "thinking...", "streaming...", "⚙️ read_file", etc.
      streamStartTime: null,
    };

    // ── Status Bar Rendering Engine ──
    // Uses save/restore cursor + absolute row positioning to pin
    // a 3-line box at the bottom of the terminal. This means the
    // bar stays visible even while streaming output scrolls above it.

    const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    const drawStatusBar = () => {
      if (!cliState.showStatusBar) return;

      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 24;
      const innerWidth = Math.min(cols - 4, 90);
      const boxWidth = innerWidth + 2; // +2 for the │ borders

      // ── Collect segments ──
      const modelDisp = `\x1b[1;36m${cliState.modelName || cliState.modelId}\x1b[0m`;
      const modeDisp = cliState.chatMode === "expert"
        ? "\x1b[1;35m\u{1F451} Expert\x1b[0m"
        : "\x1b[1;36m\u26A1 Instant\x1b[0m";

      const thinkDisp = cliState.think === true
        ? "\x1b[1;33m\u{1F9E0} ON\x1b[0m"
        : (cliState.think === false ? "\x1b[2m\u{1F9E0} OFF\x1b[0m" : "\x1b[2m\u{1F9E0} --\x1b[0m");

      const searchDisp = cliState.search
        ? "\x1b[1;32m\u{1F50D} ON\x1b[0m"
        : "\x1b[2m\u{1F50D} OFF\x1b[0m";

      // Context
      const history = getHistory();
      const histLen = JSON.stringify(history).length;
      const pct = Math.min(100, (histLen / 500000) * 100).toFixed(0);
      const ctxBar = buildMiniBar(parseFloat(pct), 8);
      const ctxDisp = `\x1b[2mCtx ${ctxBar} ${pct}%\x1b[0m`;

      // Speed
      let speedDisp;
      if (cliState.isStreaming && cliState.streamStartTime) {
        const secs = (Date.now() - cliState.streamStartTime) / 1000;
        const speed = secs > 0 ? (cliState.tokenCount / secs).toFixed(0) : "0";
        speedDisp = `\x1b[1;33m${speed} t/s\x1b[0m`;
      } else {
        speedDisp = `\x1b[2midle\x1b[0m`;
      }

      // Action
      let actionDisp;
      if (cliState.currentAction && cliState.currentAction !== "idle") {
        actionDisp = `\x1b[1;33m${cliState.currentAction}\x1b[0m`;
      } else {
        actionDisp = `\x1b[2mready\x1b[0m`;
      }

      const content = ` ${modelDisp} \x1b[2m│\x1b[0m ${modeDisp} \x1b[2m│\x1b[0m ${thinkDisp} \x1b[2m│\x1b[0m ${searchDisp} \x1b[2m│\x1b[0m ${ctxDisp} \x1b[2m│\x1b[0m ${speedDisp} \x1b[2m│\x1b[0m ${actionDisp} `;

      // Pad the visible content to fill the box
      const visLen = stripAnsi(content).length;
      const pad = Math.max(0, innerWidth - visLen);
      const paddedContent = content + " ".repeat(pad);

      const topBorder    = `\x1b[2m\u250C${"\u2500".repeat(innerWidth)}\u2510\x1b[0m`;
      const contentLine   = `\x1b[2m\u2502\x1b[0m${paddedContent}\x1b[2m\u2502\x1b[0m`;
      const bottomBorder  = `\x1b[2m\u2514${"\u2500".repeat(innerWidth)}\u2518\x1b[0m`;

      // Save cursor, draw at bottom 3 rows, restore cursor
      process.stdout.write(
        `\x1b[s` +                           // save cursor
        `\x1b[${rows - 2};1H\x1b[K${topBorder}` +  // row: rows-2
        `\x1b[${rows - 1};1H\x1b[K${contentLine}` + // row: rows-1
        `\x1b[${rows};1H\x1b[K${bottomBorder}` +    // row: rows
        `\x1b[u`                             // restore cursor
      );
    };

    // Mini progress bar helper: ████░░░░ style
    function buildMiniBar(percent, width) {
      const filled = Math.round((percent / 100) * width);
      const empty = width - filled;
      return `\x1b[36m${"\u2588".repeat(filled)}\x1b[2m${"\u2591".repeat(empty)}\x1b[0m`;
    }

    const clearStatusBar = () => {
      const rows = process.stdout.rows || 24;
      process.stdout.write(
        `\x1b[s` +
        `\x1b[${rows - 2};1H\x1b[K` +
        `\x1b[${rows - 1};1H\x1b[K` +
        `\x1b[${rows};1H\x1b[K` +
        `\x1b[u`
      );
    };

    // Redraw the status bar on a fixed interval so it updates during streaming
    let statusBarTimer = setInterval(() => {
      if (cliState.showStatusBar) drawStatusBar();
    }, 250);

    // Also hook readline refresh so it draws during typing
    const originalRefreshLine = rl._refreshLine;
    rl._refreshLine = function() {
      originalRefreshLine.call(rl);
      drawStatusBar();
    };

    // Ensure we set up a scroll region that leaves room for the status bar
    const setupScrollRegion = () => {
      const rows = process.stdout.rows || 24;
      process.stdout.write(`\x1b[1;${rows - 3}r`); // scroll region rows 1 to rows-3
      process.stdout.write(`\x1b[${Math.max(1, rows - 4)};1H`); // move cursor into scroll region
    };
    setupScrollRegion();
    process.stdout.on('resize', () => {
      setupScrollRegion();
      drawStatusBar();
    });

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

          cliState.currentAction = "authenticating...";

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
          cliState.currentAction = "idle";
          rl.prompt();
          return;
        }

        if (cmd === "clear" || cmd === "cls") {
          clearHistory();
          cliState.sessionId = null;
          cliState.parentId = null;
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
            cliState.modelId = newId;
            cliState.provider = newProvider;
            cliState.sessionId = null; // Reset session when switching models
            cliState.parentId = null;
            allModels = await getAllModels();
            const name = allModels.find((m) => m.id === newId)?.name || newId;
            cliState.modelName = name;
            success(`Switched to: ${name} (${newProvider})`);
          }
          rl.prompt();
          return;
        }

        if (cmd === "agent" && args.length > 0) {
          const agentTask = args.join(" ");
          
          cliState.currentAction = "agent task...";
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
          cliState.currentAction = "idle";
          rl.resume();
          rl.prompt();
          return;
        }

        if (cmd === "instant" || cmd === "expert") {
          cliState.chatMode = cmd;
          success(`Switched to ${cmd === "instant" ? "Instant" : "Expert"} mode`);
          rl.prompt();
          return;
        }

        if (["think", "search"].includes(cmd)) {
          const val = args[0]?.toLowerCase();
          if (val === "on" || val === "off") {
            cliState[cmd] = (val === "on");
            success(`${cmd} mode is now ${val.toUpperCase()}`);
          } else {
            const current = cliState[cmd];
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
      cliState.tokenCount = 0;
      cliState.isStreaming = true;
      cliState.streamStartTime = Date.now();
      cliState.currentAction = "thinking...";

      rl.pause();

      // Record user turn in history, then send
      const currentModelId = modelId;
      const currentProvider = provider;
      const userMessage = input;
      pushUser(userMessage);

      try {
        let turnOptions = { ...cliState };
        
        // Auto-detect if the message needs web search
        const searchKeywords = /\b(news|weather|latest|current|today|stock|price|score|trending|search|google|look\s*up|find\s+online|what.s happening|headlines)\b/i;
        if (!turnOptions.search && searchKeywords.test(userMessage)) {
          turnOptions.search = true;
          cliState.search = true; // persist for future turns
          info(`\x1b[2m🔍 Auto-enabled web search for this query\x1b[0m`);
        }
        
        console.log("");
        process.stdout.write("\x1b[33m⟡\x1b[0m ");

        let isThinkingMode = false;
        let thinkingStarted = false;
        let spinner = null;

        const onChunk = (chunk, isThinking = false) => {
          if (isThinking) {
            if (!thinkingStarted) {
              thinkingStarted = true;
              isThinkingMode = true;
              cliState.currentAction = "\u{1F4AD} thinking...";
              spinner = createSpinner("Thinking...").start();
            }
          } else {
            if (isThinkingMode) {
              isThinkingMode = false;
              cliState.currentAction = "streaming...";
              if (spinner) {
                spinner.stop();
                spinner = null;
              }
            }
            process.stdout.write(chunk);
            cliState.tokenCount += Math.max(1, chunk.length / 4);
          }
        };

        const onConfirm = async (tool, args) => {
          if (spinner) {
            spinner.stop();
            spinner = null;
          }
          let promptText = "";
          if (tool === "execute_command") {
            promptText = `\x1b[33m⚠️ Run command '${args.command}'? (y/N):\x1b[0m `;
          } else if (tool === "write_file") {
            promptText = `\x1b[33m⚠️ Create/overwrite file '${args.path}'? (y/N):\x1b[0m `;
          } else if (tool === "edit_file") {
            promptText = `\x1b[33m⚠️ Modify file '${args.path}'? (y/N):\x1b[0m `;
          } else if (tool === "browser_action") {
            promptText = `\x1b[33m⚠️ Browser: '${args.command}'? (y/N):\x1b[0m `;
          } else {
            return true;
          }

          return new Promise((resolve) => {
            rl.question(promptText, (answer) => {
              const normalized = answer.trim().toLowerCase();
              resolve(normalized === "y" || normalized === "yes");
            });
          });
        };

        const onToolRun = (toolName, toolArgs) => {
          const shortPath = toolArgs.path ? toolArgs.path.split(/[/\\]/).pop() : '';
          const shortCmd = toolArgs.command ? toolArgs.command.slice(0, 30) : '';
          if (shortPath) {
            cliState.currentAction = `\u2699\ufe0f ${toolName} \u2192 ${shortPath}`;
          } else if (shortCmd) {
            cliState.currentAction = `\u2699\ufe0f ${toolName} \u2192 ${shortCmd}`;
          } else {
            cliState.currentAction = `\u2699\ufe0f ${toolName}`;
          }
        };

        const startTime = Date.now();
        await runAgentLoop(userMessage, currentModelId, currentProvider, turnOptions, onChunk, onConfirm, onToolRun);

        if (spinner) {
          spinner.stop();
          spinner = null;
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const speed = elapsed > 0 ? (cliState.tokenCount / elapsed).toFixed(1) : "0.0";
        console.log("");
        console.log(`\x1b[2m── Done in ${elapsed}s (${speed} t/s)\x1b[0m`);
      } catch (e) {
        error(e.message);
      }

      // Restore terminal state and resume readline
      cliState.isStreaming = false;
      cliState.streamStartTime = null;
      cliState.currentAction = "idle";
      process.stdout.write("\x1b[?25h"); // force show cursor
      console.log("");
      rl.resume();
      rl.prompt();
    });

    rl.on("close", () => {
      clearInterval(statusBarTimer);
      clearStatusBar();
      // Reset scroll region to full terminal
      process.stdout.write(`\x1b[r`);
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
  let tokenCount = 0;
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
      tokenCount += Math.max(1, chunk.length / 4);
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
    const speed = elapsed > 0 ? (tokenCount / elapsed).toFixed(1) : "0.0";
    const turnNum = Math.floor(history.length / 2) + 1;
    const turnInfo = history.length > 0 ? ` · turn ${turnNum}` : "";
    console.log("");
    if (thinkingText) {
      console.log(`\x1b[2m── 💭 Thought for ${elapsed}s · ${charCount} chars (${speed} t/s)${turnInfo}\x1b[0m`);
    } else {
      console.log(`\x1b[2m── ${charCount} chars · ${elapsed}s (${speed} t/s)${turnInfo}\x1b[0m`);
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
