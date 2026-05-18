import { streamDeepseek } from "./src/providers/deepseek.js";

async function run() {
  console.log("Starting...");
  await streamDeepseek("Calculate 1+1", "deepseek_reasoner", (chunk, isThinking) => {
    console.log(`[${isThinking ? 'THINK' : 'TEXT'}] ${chunk.replace(/\n/g, '\\n')}`);
  }, () => {
    console.log("Done");
  });
}

run();
