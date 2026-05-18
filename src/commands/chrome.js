/**
 * `webclaw chrome` — Launch Chrome in debug mode
 */

import { findChrome, getUserDataDir, launchChrome, isChromeRunning, CDP_PORT } from "../browser/chrome.js";
import { success, error, info, warn } from "../ui/banner.js";

export const chromeCommand = {
  command: "chrome",
  describe: "Launch Chrome in debug mode for browser automation",
  builder: (yargs) =>
    yargs.option("url", {
      describe: "Additional URL to open",
      type: "string",
    }),
  handler: async (argv) => {
    const chromePath = findChrome();
    if (!chromePath) {
      error("Chrome not found! Please install Google Chrome.");
      process.exit(1);
    }

    info(`Chrome found: ${chromePath}`);
    info(`Debug port: ${CDP_PORT}`);
    info(`User data: ${getUserDataDir()}`);

    const running = await isChromeRunning();
    if (running) {
      success("Chrome debug mode is already running!");
      info(`Connect at: http://127.0.0.1:${CDP_PORT}`);
      info("");
      info("Next steps:");
      info("  1. Log in to your AI platforms in Chrome");
      info("  2. Run: webclaw auth qwen      (for Qwen International)");
      info("  3. Run: webclaw auth deepseek   (for DeepSeek)");
      info("  4. Run: webclaw chat            (start chatting!)");
      return;
    }

    info("Launching Chrome in debug mode...");

    try {
      const result = launchChrome();
      
      // Wait for Chrome to start
      let ready = false;
      for (let i = 0; i < 15; i++) {
        process.stdout.write(".");
        ready = await isChromeRunning();
        if (ready) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      console.log("");

      if (ready) {
        success("Chrome debug mode started!");
        info("");
        info("Opening AI platform login pages...");

        // Open login pages in Chrome
        const { execSync } = await import("node:child_process");
        const urls = [
          "https://chat.qwen.ai",
          "https://chat.deepseek.com",
        ];

        for (const url of urls) {
          try {
            const { spawn } = await import("node:child_process");
            spawn(chromePath, [
              `--remote-debugging-port=${CDP_PORT}`,
              `--user-data-dir=${getUserDataDir()}`,
              url,
            ], { stdio: "ignore", detached: true }).unref();
            await new Promise((r) => setTimeout(r, 500));
          } catch { /* ignore */ }
        }

        success("Opened: Qwen International + DeepSeek");
        info("");
        info("╔═══════════════════════════════════════════╗");
        info("║           Next Steps                      ║");
        info("╠═══════════════════════════════════════════╣");
        info("║ 1. Log in to Qwen / DeepSeek in Chrome    ║");
        info("║ 2. webclaw auth qwen                      ║");
        info("║ 3. webclaw auth deepseek                  ║");
        info("║ 4. webclaw chat                           ║");
        info("╚═══════════════════════════════════════════╝");
      } else {
        error("Chrome failed to start. Try launching manually:");
        info(`  "${chromePath}" --remote-debugging-port=${CDP_PORT} --user-data-dir="${getUserDataDir()}"`);
      }
    } catch (e) {
      error(`Failed to launch Chrome: ${e.message}`);
      process.exit(1);
    }
  },
};
