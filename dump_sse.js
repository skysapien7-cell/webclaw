import { getAuth } from "./src/auth/store.js";
import { solvePoW, createSession, makeHeaders } from "./src/providers/deepseek.js";

async function run() {
  const auth = getAuth("deepseek");
  const targetPath = "/api/v0/chat/completion";
  const BASE = "https://chat.deepseek.com";
  const sessionId = await createSession(auth);
  const powResponse = await solvePoW(auth, targetPath);

  const headers = makeHeaders(auth);
  headers["Accept"] = "text/event-stream";
  if (powResponse) headers["x-ds-pow-response"] = powResponse;

  const response = await fetch(`${BASE}${targetPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: null,
      prompt: "Calculate 1+1",
      ref_file_ids: [],
      thinking_enabled: true,
      search_enabled: false,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  
  let i = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.startsWith("data:")) {
        console.log(line);
        i++;
        if (i > 10) return;
      }
    }
  }
}

run();
