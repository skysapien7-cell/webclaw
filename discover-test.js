import { chromium } from "playwright-core";
import fs from "fs";

async function run() {
  const wsUrlUrl = "http://127.0.0.1:9222/json/version";
  const res = await fetch(wsUrlUrl);
  const data = await res.json();
  const wsUrl = data.webSocketDebuggerUrl;

  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0];
  
  // Test deepseek
  let dsPage = context.pages().find(p => p.url().includes("chat.deepseek.com"));
  if (!dsPage) {
    dsPage = await context.newPage();
    await dsPage.goto("https://chat.deepseek.com");
  }
  
  const dsModels = await dsPage.evaluate(async () => {
    try {
      const authHeader = localStorage.getItem("userToken");
      const r = await fetch("/api/v0/models", {
        headers: { "authorization": `Bearer ${JSON.parse(authHeader).value}` }
      });
      return await r.json();
    } catch(e) { return e.toString(); }
  });
  console.log("DeepSeek Models:", dsModels);

  // Test qwen
  let qwPage = context.pages().find(p => p.url().includes("chat.qwen.ai"));
  if (!qwPage) {
    qwPage = await context.newPage();
    await qwPage.goto("https://chat.qwen.ai");
  }
  
  const qwModels = await qwPage.evaluate(async () => {
    try {
      const r = await fetch("https://chat.qwen.ai/api/models");
      return await r.json();
    } catch(e) { return e.toString(); }
  });
  console.log("Qwen Models State:", qwModels);

  await browser.close();
}

run();
