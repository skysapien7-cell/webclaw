/**
 * `webclaw models` — List available models
 */

import { fetchQwenModels } from "../providers/qwen.js";
import { fetchDeepseekModels } from "../providers/deepseek.js";
import { getAuth } from "../auth/store.js";
import { info, success, warn } from "../ui/banner.js";

export const modelsCommand = {
  command: "models",
  describe: "List available AI models",
  handler: async () => {
    const qwenAuth = getAuth("qwen");
    const deepseekAuth = getAuth("deepseek");

    info("Available Models:");
    info("═══════════════════════════════════════════════════════════");
    info("");

    // Qwen models
    const qwenStatus = qwenAuth ? "\x1b[32m✓ authenticated\x1b[0m" : "\x1b[31m✗ not authenticated\x1b[0m";
    info(`\x1b[1m🟢 Qwen International\x1b[0m (chat.qwen.ai) [${qwenStatus}]`);
    info(`   Works in India — no VPN needed`);
    info("");
    for (const m of await fetchQwenModels()) {
      console.log(`   \x1b[36m${m.id.padEnd(25)}\x1b[0m ${m.name.padEnd(25)} ${m.description}`);
    }
    info("");

    // DeepSeek models
    const dsStatus = deepseekAuth ? "\x1b[32m✓ authenticated\x1b[0m" : "\x1b[31m✗ not authenticated\x1b[0m";
    info(`\x1b[1m🔵 DeepSeek\x1b[0m (chat.deepseek.com) [${dsStatus}]`);
    info("");
    for (const m of await fetchDeepseekModels()) {
      console.log(`   \x1b[36m${m.id.padEnd(25)}\x1b[0m ${m.name.padEnd(25)} ${m.description}`);
    }
    info("");

    info("═══════════════════════════════════════════════════════════");
    info("Usage: webclaw chat --model <model-id>");
    info("       webclaw chat --model qwen-max-latest");
    info("       webclaw chat --model deepseek_reasoner");
  },
};
