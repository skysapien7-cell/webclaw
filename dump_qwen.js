import { connectToChrome } from "./src/browser/chrome.js";
import { getAuth } from "./src/auth/store.js";
import { randomUUID } from "node:crypto";

async function run() {
  const auth = getAuth("qwen");
  const { browser, context } = await connectToChrome();
  const pages = context.pages();
  let page = pages.find((p) => p.url().includes("qwen.ai"));
  const fid = randomUUID();

  const responseData = await page.evaluate(async ({ baseUrl, model, message, fid }) => {
    const res = await fetch(`${baseUrl}/api/v2/chat/completions?chat_id=test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify({
        stream: true, version: "2.1", incremental_output: true, chat_id: "test",
        chat_mode: "normal", model: model, parent_id: null,
        messages: [{
          fid, parentId: null, childrenIds: [], role: "user", content: message,
          user_action: "chat", files: [], timestamp: Math.floor(Date.now() / 1000),
          models: [model], chat_type: "t2t",
          feature_config: { thinking_enabled: true, output_schema: "phase" },
        }],
      }),
    });
    
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(decoder.decode(value, { stream: true }));
      if (out.length > 5) break;
    }
    return out;
  }, { baseUrl: "https://chat.qwen.ai", model: "qwen3.5-omni-flash", message: "Calculate 1+1", fid });

  console.log(responseData);
  process.exit(0);
}
run();
