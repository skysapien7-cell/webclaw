/**
 * `webclaw auth <provider>` — Capture auth credentials from Chrome
 */

import { loginQwen } from "../auth/qwen.js";
import { loginDeepseek } from "../auth/deepseek.js";
import { getAuth } from "../auth/store.js";
import { success, error, info, warn } from "../ui/banner.js";

export const authCommand = {
  command: "auth [provider]",
  describe: "Capture login credentials from Chrome browser",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "Provider to authenticate",
        choices: ["qwen", "deepseek", "status"],
        default: "status",
      }),
  handler: async (argv) => {
    const provider = argv.provider;

    if (provider === "status") {
      info("Auth Status:");
      info("─────────────────────────────────────");

      const qwen = getAuth("qwen");
      if (qwen) {
        success(`Qwen International: ✓ authenticated (saved ${qwen.savedAt || "unknown"})`);
      } else {
        warn("Qwen International: ✗ not authenticated");
        info("  Run: webclaw auth qwen");
      }

      const deepseek = getAuth("deepseek");
      if (deepseek) {
        success(`DeepSeek: ✓ authenticated (saved ${deepseek.savedAt || "unknown"})`);
      } else {
        warn("DeepSeek: ✗ not authenticated");
        info("  Run: webclaw auth deepseek");
      }
      return;
    }

    if (provider === "qwen") {
      info("Authenticating with Qwen International (chat.qwen.ai)...");
      info("Make sure Chrome debug mode is running (webclaw chrome)");
      info("");

      try {
        const creds = await loginQwen((msg) => info(msg));
        success("Qwen International authenticated successfully!");
        info(`Cookie length: ${creds.cookie.length} chars`);
        info(`Token: ${creds.token ? "captured" : "cookie-only mode"}`);
        info("");
        info("You can now chat: webclaw chat --model qwen-max-latest");
      } catch (e) {
        error(`Qwen auth failed: ${e.message}`);
        process.exit(1);
      }
      return;
    }

    if (provider === "deepseek") {
      info("Authenticating with DeepSeek (chat.deepseek.com)...");
      info("Make sure Chrome debug mode is running (webclaw chrome)");
      info("");

      try {
        const creds = await loginDeepseek((msg) => info(msg));
        success("DeepSeek authenticated successfully!");
        info(`Cookie length: ${creds.cookie.length} chars`);
        info(`Bearer: ${creds.bearer ? "captured" : "cookie-only mode"}`);
        info("");
        info("You can now chat: webclaw chat --model deepseek_chat");
      } catch (e) {
        error(`DeepSeek auth failed: ${e.message}`);
        process.exit(1);
      }
      return;
    }
  },
};
