import { streamQwen } from "./src/providers/qwen.js";

async function run() {
  console.log("Starting Qwen test...");
  await streamQwen("Calculate 1+1", "qwen3.5-omni-flash", (chunk, isThinking) => {
    console.log(`[${isThinking ? 'THINK' : 'TEXT'}] ${chunk.replace(/\n/g, '\\n')}`);
  }, () => {
    console.log("Done");
  });
}

run();
