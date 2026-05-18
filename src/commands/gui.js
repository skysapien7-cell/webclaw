/**
 * webclaw gui — starts the GUI bridge server and opens the UI in Chrome.
 */

export const command = "gui";
export const describe = "Start the WebClaw GUI (opens in your browser at localhost:8324)";
export const builder = {};

export async function handler() {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serverPath = path.join(__dirname, "../../gui-server.js");

  console.log("\x1b[36m⟡ Starting WebClaw GUI...\x1b[0m\n");

  // Spawn the server (inherits stdio so logs show in terminal)
  const proc = spawn(process.execPath, [serverPath], {
    stdio: "inherit",
    env: process.env,
  });

  proc.on("error", (err) => {
    console.error(`\x1b[31m✗ Failed to start GUI server: ${err.message}\x1b[0m`);
    process.exit(1);
  });

  // Give the server 1.5s to start, then open the browser
  setTimeout(() => {
    const url = "http://localhost:8324";
    const opener =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", url]]
        : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
    spawn(opener[0], opener[1], { detached: true, stdio: "ignore" }).unref();
    console.log(`\x1b[32m✓\x1b[0m Opened \x1b[36m${url}\x1b[0m in your browser`);
  }, 1500);

  // Forward SIGINT to the server
  process.on("SIGINT", () => {
    proc.kill("SIGINT");
    process.exit(0);
  });
}
