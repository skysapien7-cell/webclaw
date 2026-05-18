/**
 * Auth credential storage — simple JSON file on disk.
 * Stores captured cookies/tokens for Qwen and DeepSeek.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

function getStateDir() {
  const os = platform();
  if (os === "win32") return join(process.env.LOCALAPPDATA || homedir(), "webclaw");
  if (os === "darwin") return join(homedir(), "Library/Application Support/webclaw");
  return join(homedir(), ".config/webclaw");
}

const STATE_DIR = getStateDir();
const AUTH_FILE = join(STATE_DIR, "auth.json");

/**
 * Load stored auth credentials.
 */
export function loadAuth() {
  try {
    if (existsSync(AUTH_FILE)) {
      return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return {};
}

/**
 * Save auth credentials for a provider.
 */
export function saveAuth(provider, credentials) {
  const auth = loadAuth();
  auth[provider] = {
    ...credentials,
    savedAt: new Date().toISOString(),
  };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

/**
 * Get auth for a specific provider.
 */
export function getAuth(provider) {
  const auth = loadAuth();
  return auth[provider] || null;
}

/**
 * Clear auth for a specific provider.
 */
export function clearAuth(provider) {
  const auth = loadAuth();
  delete auth[provider];
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2));
}

export { STATE_DIR, AUTH_FILE };
