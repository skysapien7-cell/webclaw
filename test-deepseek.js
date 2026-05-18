import { streamDeepseek } from "./src/providers/deepseek.js";

async function test() {
  console.log("Starting Deepseek test...");
  try {
    await streamDeepseek(
      "Hello! Tell me who you are in one sentence.",
      "deepseek_chat",
      (chunk) => process.stdout.write(chunk),
      (done) => console.log("\nDone:", done),
      undefined
    );
  } catch (err) {
    console.error("Error:", err);
  }
}

test();
