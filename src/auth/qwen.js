/**
 * Qwen International (chat.qwen.ai) — Web Auth Capture
 * 
 * Connects to Chrome via CDP, navigates to Qwen, and captures
 * session cookies + auth tokens once the user logs in.
 * 
 * Derived from openclaw-zero-token/src/zero-token/providers/qwen-web-auth.ts
 */

import { connectToChrome } from "../browser/chrome.js";
import { saveAuth } from "./store.js";

const QWEN_URL = "https://chat.qwen.ai";
const LOGIN_TIMEOUT = 300_000; // 5 minutes

/**
 * Capture Qwen International auth credentials from Chrome.
 * @param {(msg: string) => void} onProgress - Progress callback
 * @returns {Promise<{cookie: string, token: string, userAgent: string}>}
 */
export async function loginQwen(onProgress) {
  onProgress("Connecting to Chrome...");
  const { browser, context } = await connectToChrome();

  try {
    // Find existing Qwen tab or create new one
    const pages = context.pages();
    let page = pages.find((p) => p.url().includes("qwen.ai") || p.url().includes("chat.qwen"));

    if (page) {
      onProgress("Found existing Qwen tab, switching to it...");
      await page.bringToFront();
    } else {
      page = await context.newPage();
      onProgress("Opening Qwen International...");
      await page.goto(QWEN_URL);
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);

    // Check if already logged in
    onProgress("Checking for existing session...");
    const existingCookies = await context.cookies([QWEN_URL]);
    const hasSession = existingCookies.some(
      (c) => c.name.includes("token") || c.name.includes("session") || c.name.includes("_t")
    );

    if (hasSession && existingCookies.length > 2) {
      const cookieStr = existingCookies.map((c) => `${c.name}=${c.value}`).join("; ");
      
      // Try to extract auth token from localStorage
      let token = "";
      try {
        token = await page.evaluate(() => {
          // Qwen stores auth in localStorage
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.includes("token") || key.includes("auth") || key.includes("user"))) {
              const val = localStorage.getItem(key);
              if (val && val.length > 20) {
                try {
                  const parsed = JSON.parse(val);
                  if (parsed.token) return parsed.token;
                  if (typeof parsed === "string") return parsed;
                } catch {
                  return val;
                }
              }
            }
          }
          return "";
        });
      } catch { /* ignore */ }

      onProgress("Existing session found!");
      const creds = { cookie: cookieStr, token, userAgent };
      saveAuth("qwen", creds);
      return creds;
    }

    // Wait for user to log in
    onProgress("Please log in to Qwen International (chat.qwen.ai) in the browser...");
    onProgress("Waiting for login... (5 minute timeout)");

    return await new Promise((resolve, reject) => {
      let resolved = false;
      let capturedToken = "";

      const timeout = setTimeout(() => {
        if (!resolved) reject(new Error("Qwen login timed out (5 minutes)."));
      }, LOGIN_TIMEOUT);

      const tryCapture = async () => {
        if (resolved) return;
        try {
          const cookies = await context.cookies([QWEN_URL, "https://qwen.ai"]);
          if (cookies.length < 2) return;

          const cookieStr = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
          const hasAuth = cookies.some(
            (c) => c.name.includes("token") || c.name.includes("session") || c.name.includes("_t")
          );

          if (hasAuth || capturedToken || cookies.length > 3) {
            resolved = true;
            clearTimeout(timeout);
            clearInterval(checkInterval);

            // Try localStorage token
            if (!capturedToken) {
              try {
                capturedToken = await page.evaluate(() => {
                  for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && (key.includes("token") || key.includes("auth"))) {
                      const val = localStorage.getItem(key);
                      if (val && val.length > 20) return val;
                    }
                  }
                  return "";
                });
              } catch { /* ignore */ }
            }

            const creds = { cookie: cookieStr, token: capturedToken, userAgent };
            saveAuth("qwen", creds);
            resolve(creds);
          }
        } catch { /* retry */ }
      };

      // Intercept API requests for auth headers
      page.on("request", async (request) => {
        const url = request.url();
        if (url.includes("qwen.ai") || url.includes("aone.alibaba")) {
          const headers = request.headers();
          const auth = headers["authorization"] || headers["x-auth-token"];
          if (auth && !capturedToken) {
            capturedToken = auth.replace(/^Bearer\s+/i, "");
            await tryCapture();
          }
        }
      });

      page.on("response", async (response) => {
        if (response.url().includes("qwen.ai") && response.ok()) {
          await tryCapture();
        }
      });

      const checkInterval = setInterval(tryCapture, 3000);
    });
  } finally {
    // Don't close — user's Chrome stays open
  }
}
