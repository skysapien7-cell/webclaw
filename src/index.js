#!/usr/bin/env node
/**
 * WebClaw — Zero-cost AI CLI Agent
 * 
 * Combined agent inspired by OpenClaw (Chrome browser automation) 
 * and OpenCode (clean CLI interface).
 * 
 * Supports ONLY:
 *   - Qwen International (chat.qwen.ai) — works in India
 *   - DeepSeek (chat.deepseek.com)
 * 
 * Uses Chrome DevTools Protocol (CDP) to hijack logged-in browser
 * sessions and stream AI responses through the web interface APIs.
 * 
 * License: MIT (derived from openclaw-zero-token + opencode, both MIT)
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { authCommand } from "./commands/auth.js";
import { chatCommand } from "./commands/chat.js";
import { modelsCommand } from "./commands/models.js";
import { chromeCommand } from "./commands/chrome.js";
import { agentCommand } from "./commands/agent.js";
import * as guiCommand from "./commands/gui.js";
import { banner } from "./ui/banner.js";

const args = hideBin(process.argv);

console.log(banner());

const cli = yargs(args)
  .scriptName("webclaw")
  .usage("$0 <command> [options]")
  .wrap(90)
  .help("help")
  .alias("help", "h")
  .version("1.0.0")
  .alias("version", "v")
  .command(chromeCommand)
  .command(authCommand)
  .command(chatCommand)
  .command(modelsCommand)
  .command(agentCommand)
  .command(guiCommand)
  .demandCommand(1, "Please specify a command. Run webclaw --help for usage.")
  .strict()
  .fail((msg, err) => {
    if (msg) console.error(`\x1b[31m✗\x1b[0m ${msg}`);
    if (err) console.error(err.message);
    process.exit(1);
  });

try {
  await cli.parse();
} catch (e) {
  console.error(`\x1b[31m✗ Fatal error:\x1b[0m`, e instanceof Error ? e.message : e);
  process.exit(1);
}
