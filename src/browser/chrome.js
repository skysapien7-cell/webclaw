/**
 * Chrome CDP connection manager.
 * Handles launching Chrome in debug mode and connecting via Playwright.
 * 
 * Derived from openclaw-zero-token's browser automation layer,
 * stripped to essentials.
 */

import { chromium } from "playwright-core";
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

const CDP_PORT = 9222;
const CDP_URL = `http://127.0.0.1:${CDP_PORT}`;

/**
 * Find Chrome/Chromium executable on the system.
 */
export function findChrome() {
  const os = platform();

  if (os === "win32") {
    const paths = [
      join(process.env.PROGRAMFILES || "", "Google/Chrome/Application/chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "", "Google/Chrome/Application/chrome.exe"),
      join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    ];
    for (const p of paths) {
      if (existsSync(p)) return p;
    }
  }

  if (os === "darwin") {
    const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (existsSync(macPath)) return macPath;
  }

  if (os === "linux") {
    const linuxPaths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
    ];
    for (const p of linuxPaths) {
      if (existsSync(p)) return p;
    }
  }

  return null;
}

/**
 * Get Chrome user data directory for isolated debug profile.
 */
export function getUserDataDir() {
  const os = platform();
  if (os === "win32") return join(process.env.LOCALAPPDATA || homedir(), "WebClaw-Chrome-Debug");
  if (os === "darwin") return join(homedir(), "Library/Application Support/WebClaw-Chrome-Debug");
  return join(homedir(), ".config/webclaw-chrome-debug");
}

/**
 * Check if Chrome debug port is already active.
 */
export async function isChromeRunning() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Get Chrome WebSocket debugger URL.
 */
export async function getChromeWsUrl(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        return data.webSocketDebuggerUrl || null;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Launch Chrome in debug mode.
 */
export function launchChrome() {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome not found. Please install Google Chrome.");
  }

  const userDataDir = getUserDataDir();

  const proc = spawn(chromePath, [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--remote-allow-origins=http://127.0.0.1:*",
  ], {
    stdio: "ignore",
    detached: true,
  });

  proc.unref();
  return { proc, port: CDP_PORT, userDataDir };
}

/**
 * Connect to Chrome via CDP and return Playwright browser + context.
 */
export async function connectToChrome() {
  const wsUrl = await getChromeWsUrl(15000);
  if (!wsUrl) {
    throw new Error(
      `Cannot connect to Chrome at ${CDP_URL}.\n` +
      `Run: webclaw chrome   to start Chrome in debug mode first.`
    );
  }

  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0] || await browser.newContext();
  return { browser, context };
}

export { CDP_PORT, CDP_URL };
