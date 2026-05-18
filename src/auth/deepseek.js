/**
 * DeepSeek (chat.deepseek.com) — Web Auth Capture
 * 
 * Connects to Chrome via CDP, navigates to DeepSeek, and captures
 * session cookies + bearer token once the user logs in.
 * 
 * Derived from openclaw-zero-token/src/zero-token/providers/deepseek-web-auth.ts
 */

import { connectToChrome } from "../browser/chrome.js";
import { saveAuth } from "./store.js";

const DEEPSEEK_URL = "https://chat.deepseek.com";
const LOGIN_TIMEOUT = 300_000; // 5 minutes

/**
 * Capture DeepSeek auth credentials from Chrome.
 * @param {(msg: string) => void} onProgress - Progress callback
 * @returns {Promise<{cookie: string, bearer: string, userAgent: string}>}
 */
export async function loginDeepseek(onProgress) {
  onProgress("Connecting to Chrome...");
  const { browser, context } = await connectToChrome();

  try {
    // Find existing DeepSeek tab or create new one
    const pages = context.pages();
    let page = pages.find(
      (p) => p.url().includes("deepseek.com") || p.url().includes("chat.deepseek")
    );

    if (page) {
      onProgress("Found existing DeepSeek tab, switching to it...");
      await page.bringToFront();
    } else {
      page = await context.newPage();
      onProgress("Opening DeepSeek...");
      await page.goto(DEEPSEEK_URL);
    }

    const userAgent = await page.evaluate(() => navigator.userAgent);

    // Check if already logged in
    onProgress("Checking for existing session...");
    const existingCookies = await context.cookies([
      "https://chat.deepseek.com",
      "https://deepseek.com",
    ]);
    const cookieStr = existingCookies.map((c) => `${c.name}=${c.value}`).join("; ");

    const hasDeviceId = cookieStr.includes("d_id=");
    const hasSessionId = cookieStr.includes("ds_session_id=");
    const hasValidSession =
      (hasDeviceId || hasSessionId || existingCookies.length > 3) && cookieStr.length > 10;

    let bearer = "";

    if (hasValidSession) {
      onProgress("Found existing session, capturing token...");

      // Try localStorage for token
      try {
        bearer = await page.evaluate(() => {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.toLowerCase().includes("token") || key.toLowerCase().includes("auth"))) {
              const val = localStorage.getItem(key);
              if (val) {
                try {
                  const parsed = JSON.parse(val);
                  if (parsed.token) return parsed.token;
                  if (typeof parsed === "string" && parsed.length > 20) return parsed;
                } catch {
                  if (val.length > 20) return val;
                }
              }
            }
          }
          return "";
        });
      } catch { /* ignore */ }

      // Try API endpoint for token
      if (!bearer) {
        try {
          const response = await page.request.get(
            "https://chat.deepseek.com/api/v0/users/current",
            { headers: { Cookie: cookieStr } }
          );
          if (response.ok()) {
            const data = await response.json();
            bearer = data?.data?.biz_data?.token || "";
          }
        } catch { /* ignore */ }
      }

      if (bearer) {
        onProgress("Credentials captured!");
        const creds = { cookie: cookieStr, bearer, userAgent };
        saveAuth("deepseek", creds);
        return creds;
      }
      }

    return await new Promise((resolve, reject) => {
      let capturedBearer = "";
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          clearInterval(checkInterval);
          reject(new Error("DeepSeek login timed out (5 minutes)."));
        }
      }, LOGIN_TIMEOUT);

      const tryResolve = async () => {
        if (!capturedBearer || resolved) return;

        try {
          const cookies = await context.cookies([
            "https://chat.deepseek.com",
            "https://deepseek.com",
          ]);
          if (cookies.length === 0) return;

          const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
          const hasDId = cookieString.includes("d_id=");
          const hasSess = cookieString.includes("ds_session_id=");

          if (hasDId || hasSess || cookies.length > 3) {
            resolved = true;
            clearTimeout(timeout);
            clearInterval(checkInterval);

            const creds = { cookie: cookieString, bearer: capturedBearer, userAgent };
            saveAuth("deepseek", creds);
            resolve(creds);
          }
        } catch { /* retry */ }
      };

      // Intercept API requests for bearer token
      page.on("request", async (request) => {
        const url = request.url();
        if (url.includes("/api/v0/")) {
          const headers = request.headers();
          const auth = headers["authorization"];
          if (auth?.startsWith("Bearer ")) {
            if (!capturedBearer) {
              capturedBearer = auth.slice(7);
              onProgress("Bearer token captured via request interception!");
            }
            await tryResolve();
          }
        }
      });

      // Also try extracting from users/current response
      page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("/api/v0/users/current") && response.ok()) {
          try {
            const body = await response.json();
            const token = body?.data?.biz_data?.token;
            if (typeof token === "string" && token.length > 0) {
              if (!capturedBearer) {
                capturedBearer = token;
                onProgress("Bearer token captured via response payload!");
              }
              await tryResolve();
            }
          } catch { /* ignore */ }
        }
      });

      const checkInterval = setInterval(tryResolve, 3000);

      // Now that interceptors are active, if we had a session, reload the page to trigger them
      if (hasValidSession && !bearer) {
        onProgress("Session found but no bearer token. Reloading page to intercept it...");
        page.reload().catch(() => {});
      } else {
        onProgress("Please log in to DeepSeek in the browser...");
        onProgress("Waiting for login... (5 minute timeout)");
      }
    });
  } finally {
    // Don't close — user's Chrome stays open
  }
}
