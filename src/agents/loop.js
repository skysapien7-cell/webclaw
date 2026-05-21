import { streamQwen } from "../providers/qwen.js";
import { streamDeepseek } from "../providers/deepseek.js";
import { parseToolCalls, StreamFilter } from "./parser.js";
import * as tools from "./tools.js";
import { pushUser, pushAssistant, getHistory } from "../history.js";
import { success, error, info, warn } from "../ui/banner.js";

/**
 * Runs the agent conversation loop.
 * Streams reasoning text, intercepting and executing tool calls, and feeding
 * tool results back to the model in a stateful loop.
 *
 * @param {string} initialMessage - User's initial message
 * @param {string} modelId - Model ID
 * @param {string} provider - "qwen" | "deepseek"
 * @param {object} options - Turn options (session state, think/search toggles)
 * @param {Function} onChunk - fn(chunk, isThinking) for streaming output
 * @param {Function} onConfirm - fn(toolName, args) -> Promise<boolean> for approvals
 */
export async function runAgentLoop(initialMessage, modelId, provider, options = {}, onChunk, onConfirm, onToolRun) {
  let activeMessage = initialMessage;
  let loopCount = 0;
  const maxLoops = 15; // safeguard
  let fullAgentResponse = "";

  while (loopCount < maxLoops) {
    loopCount++;
    let currentTurnText = "";
    
    // Set up real-time stream filter to strip tool tags from stdout/UI
    const filter = new StreamFilter((text) => {
      onChunk(text, false);
    });

    const handleChunk = (chunk, isThinking) => {
      if (isThinking) {
        onChunk(chunk, true); // Thinking indicator is handled by the caller
      } else {
        filter.push(chunk);
        currentTurnText += chunk;
      }
    };

    const handleDone = ({ sessionId, parentId }) => {
      filter.flush();
      if (sessionId) options.sessionId = sessionId;
      if (parentId) options.parentId = parentId;
    };

    // Run the stream turn
    const getHistoryFn = options.getHistory || getHistory;
    const pushAssistantFn = options.pushAssistant || pushAssistant;
    const pushUserFn = options.pushUser || pushUser;

    if (provider === "qwen") {
      const historyBeforeThisMessage = getHistoryFn().slice(0, -1);
      await streamQwen(activeMessage, modelId, handleChunk, handleDone, historyBeforeThisMessage, null, options);
    } else {
      const historyBeforeThisMessage = getHistoryFn().slice(0, -1);
      await streamDeepseek(activeMessage, modelId, handleChunk, handleDone, historyBeforeThisMessage, null, options);
    }

    fullAgentResponse += currentTurnText;
    pushAssistantFn(currentTurnText);

    // Parse tool calls from the completed turn
    const toolCalls = parseToolCalls(currentTurnText);
    if (toolCalls.length === 0) {
      // No tool calls: we are done
      break;
    }

    // Execute tool calls
    const toolResponses = [];
    for (const call of toolCalls) {
      const { tool, args } = call;
      
      // Let the user know the agent is running a tool
      let statusMsg = `\n\x1b[36m⟡ Running tool:\x1b[0m \x1b[1m${tool}\x1b[0m`;
      if (args.path) statusMsg += ` on \x1b[32m${args.path}\x1b[0m`;
      if (args.command) statusMsg += `: \x1b[33m${args.command}\x1b[0m`;
      console.log(statusMsg);

      // Notify the caller (e.g. status bar) about which tool is running
      if (onToolRun) onToolRun(tool, args);

      let result;
      try {
        if (tool === "execute_command") {
          // Ask for confirmation
          const approved = await onConfirm(tool, args);
          if (!approved) {
            result = `Command execution denied by the user.`;
            console.log(`\x1b[31m✗ Command execution denied by user.\x1b[0m`);
          } else {
            const runRes = await tools.execute_command(args.command);
            result = `Code: ${runRes.code}\nStdout:\n${runRes.stdout}\nStderr:\n${runRes.stderr}`;
            console.log(`\x1b[32m✓ Command finished (code: ${runRes.code}).\x1b[0m`);
          }
        } else if (tool === "read_file") {
          result = await tools.read_file(args.path, args.startLine, args.endLine);
          console.log(`\x1b[32m✓ Successfully read file.\x1b[0m`);
        } else if (tool === "write_file") {
          const approved = await onConfirm(tool, args);
          if (!approved) {
            result = `Write file denied by user.`;
            console.log(`\x1b[31m✗ File write denied by user.\x1b[0m`);
          } else {
            result = await tools.write_file(args.path, args.content);
            console.log(`\x1b[32m✓ Successfully wrote file.\x1b[0m`);
          }
        } else if (tool === "edit_file") {
          const approved = await onConfirm(tool, args);
          if (!approved) {
            result = `Edit file denied by user.`;
            console.log(`\x1b[31m✗ File edit denied by user.\x1b[0m`);
          } else {
            result = await tools.edit_file(args.path, args.targetContent, args.replacementContent);
            console.log(`\x1b[32m✓ Successfully edited file.\x1b[0m`);
          }
        } else if (tool === "list_dir") {
          result = await tools.list_dir(args.path);
          console.log(`\x1b[32m✓ Directory listed.\x1b[0m`);
        } else if (tool === "grep_search") {
          result = await tools.grep_search(args.pattern, args.path);
          console.log(`\x1b[32m✓ Search completed.\x1b[0m`);
        } else if (tool === "browser_action") {
          // Determine if this browser command needs user approval
          const cmd = args.command.trim().split(/\s+/)[0];
          const destructive = ["eval", "close"].includes(cmd);
          if (destructive) {
            const approved = await onConfirm(tool, args);
            if (!approved) {
              result = `Browser action denied by user.`;
              console.log(`\x1b[31m✗ Browser action denied by user.\x1b[0m`);
            } else {
              const runRes = await tools.browser_action(args.command);
              result = `Code: ${runRes.code}\nOutput:\n${runRes.stdout}${runRes.stderr ? `\nStderr:\n${runRes.stderr}` : ""}`;
              console.log(`\x1b[32m✓ Browser: ${cmd} completed.\x1b[0m`);
            }
          } else {
            const runRes = await tools.browser_action(args.command);
            result = `Code: ${runRes.code}\nOutput:\n${runRes.stdout}${runRes.stderr ? `\nStderr:\n${runRes.stderr}` : ""}`;
            console.log(`\x1b[32m✓ Browser: ${cmd} completed.\x1b[0m`);
          }
        } else {
          result = `Unknown tool: ${tool}`;
          console.log(`\x1b[31m✗ Unknown tool.\x1b[0m`);
        }
      } catch (err) {
        result = `Error executing tool: ${err.message}`;
        console.log(`\x1b[31m✗ Error: ${err.message}\x1b[0m`);
      }

      // Format response tag
      toolResponses.push(
        `<tool_response tool="${tool}"${args.path ? ` path="${args.path}"` : ""}>\n${result}\n</tool_response>`
      );
    }

    // Combine all tool responses into a new user message
    const nextUserMessage = toolResponses.join("\n\n");
    pushUserFn(nextUserMessage);
    activeMessage = nextUserMessage;

    // Print a spacing newline before the next stream turn
    console.log("");
  }

  return fullAgentResponse;
}
