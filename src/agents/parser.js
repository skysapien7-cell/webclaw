/**
 * StreamFilter filters out tool-related XML tags in real-time as chunks stream in,
 * preventing raw tool tags from clogging the CLI/GUI output.
 */
export class StreamFilter {
  constructor(onText) {
    this.onText = onText;
    this.buffer = "";
    this.inTag = false;
  }

  push(chunk) {
    this.buffer += chunk;
    this.process();
  }

  process() {
    let output = "";
    let i = 0;
    while (i < this.buffer.length) {
      if (!this.inTag) {
        const idx = this.buffer.indexOf("<", i);
        if (idx === -1) {
          // No tag candidate found; take all remaining content
          output += this.buffer.slice(i);
          i = this.buffer.length;
        } else {
          // Found opening bracket candidate '<'
          output += this.buffer.slice(i, idx);
          i = idx;

          // Look for matching closing bracket '>'
          const closeIdx = this.buffer.indexOf(">", i);
          if (closeIdx === -1) {
            // Closing bracket not in current buffer.
            // Save suffix starting at '<' for next push.
            break;
          } else {
            const tagText = this.buffer.slice(i, closeIdx + 1);
            // Check if this is one of our tool tags or sub-tags
            const isToolTag = /^<\/?(read_file|write_file|edit_file|list_dir|grep_search|execute_command|browser_action|search|replace)([^>]*)>$/i.test(tagText);
            if (isToolTag) {
              // Intercept: advance cursor past tag, don't output
              i = closeIdx + 1;
            } else {
              // Non-tool tag, e.g. <other_tag> or plain text, output it
              output += tagText;
              i = closeIdx + 1;
            }
          }
        }
      }
    }
    // Keep unprocessed characters
    this.buffer = this.buffer.slice(i);
    if (output) {
      this.onText(output);
    }
  }

  flush() {
    if (this.buffer && !this.inTag) {
      this.onText(this.buffer);
    }
    this.buffer = "";
  }
}

/**
 * Parses tool calls out of a completed assistant response.
 * Handles attributes (like path, start, end, pattern) and inner text formats.
 */
export function parseToolCalls(text) {
  const toolCalls = [];
  let match;

  // 1. read_file
  // Format A: <read_file path="src/index.js" start="1" end="10" />
  const readFileSelfClosingRegex = /<read_file\s+path="([^"]+)"(?:\s+start="(\d+)"\s+end="(\d+)")?\s*\/>/gi;
  while ((match = readFileSelfClosingRegex.exec(text)) !== null) {
    const [_, path, start, end] = match;
    toolCalls.push({
      tool: "read_file",
      args: {
        path,
        startLine: start ? parseInt(start, 10) : null,
        endLine: end ? parseInt(end, 10) : null,
      },
    });
  }

  // Format B: <read_file>src/index.js</read_file> or with attributes
  const readFileRegex = /<read_file(?:\s+path="([^"]+)"(?:\s+start="(\d+)"\s+end="(\d+)")?)?>(.*?)<\/read_file>/gis;
  while ((match = readFileRegex.exec(text)) !== null) {
    const [_, attrPath, attrStart, attrEnd, innerText] = match;
    const path = attrPath || innerText.trim();
    if (!toolCalls.some((tc) => tc.tool === "read_file" && tc.args.path === path)) {
      toolCalls.push({
        tool: "read_file",
        args: {
          path,
          startLine: attrStart ? parseInt(attrStart, 10) : null,
          endLine: attrEnd ? parseInt(attrEnd, 10) : null,
        },
      });
    }
  }

  // 2. write_file
  // Format: <write_file path="src/index.js">file content</write_file>
  const writeFileRegex = /<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/gi;
  while ((match = writeFileRegex.exec(text)) !== null) {
    const [_, path, content] = match;
    toolCalls.push({
      tool: "write_file",
      args: { path, content },
    });
  }

  // 3. edit_file
  // Format: <edit_file path="src/index.js"><search>old block</search><replace>new block</replace></edit_file>
  const editFileRegex = /<edit_file\s+path="([^"]+)">\s*<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit_file>/gi;
  while ((match = editFileRegex.exec(text)) !== null) {
    const [_, path, search, replace] = match;
    toolCalls.push({
      tool: "edit_file",
      args: { path, targetContent: search, replacementContent: replace },
    });
  }

  // 4. execute_command
  // Format: <execute_command>npm run test</execute_command>
  const execCmdRegex = /<execute_command>([\s\S]*?)<\/execute_command>/gi;
  while ((match = execCmdRegex.exec(text)) !== null) {
    const [_, command] = match;
    toolCalls.push({
      tool: "execute_command",
      args: { command: command.trim() },
    });
  }

  // 5. list_dir
  // Format: <list_dir /> or <list_dir>.</list_dir>
  const listDirSelfClosing = /<list_dir\s*\/>/gi;
  if (listDirSelfClosing.test(text)) {
    toolCalls.push({
      tool: "list_dir",
      args: { path: "." },
    });
  }
  const listDirRegex = /<list_dir>(.*?)<\/list_dir>/gi;
  while ((match = listDirRegex.exec(text)) !== null) {
    const path = match[1].trim() || ".";
    if (!toolCalls.some((tc) => tc.tool === "list_dir" && tc.args.path === path)) {
      toolCalls.push({
        tool: "list_dir",
        args: { path },
      });
    }
  }

  // 6. grep_search
  // Format A: <grep_search pattern="pattern" path="dir" />
  const grepSearchSelfClosing = /<grep_search\s+pattern="([^"]+)"(?:\s+path="([^"]+)")?\s*\/>/gi;
  while ((match = grepSearchSelfClosing.exec(text)) !== null) {
    const [_, pattern, path] = match;
    toolCalls.push({
      tool: "grep_search",
      args: { pattern, path: path || "." },
    });
  }

  // Format B: <grep_search pattern="pattern">dir</grep_search>
  const grepSearchRegex = /<grep_search\s+pattern="([^"]+)"(?:\s+path="([^"]+)")?>(.*?)<\/grep_search>/gi;
  while ((match = grepSearchRegex.exec(text)) !== null) {
    const [_, pattern, attrPath, innerText] = match;
    const path = attrPath || innerText.trim() || ".";
    if (!toolCalls.some((tc) => tc.tool === "grep_search" && tc.args.pattern === pattern && tc.args.path === path)) {
      toolCalls.push({
        tool: "grep_search",
        args: { pattern, path },
      });
    }
  }

  // 7. browser_action
  // Format: <browser_action>open https://example.com</browser_action>
  const browserActionRegex = /<browser_action>([\s\S]*?)<\/browser_action>/gi;
  while ((match = browserActionRegex.exec(text)) !== null) {
    const [_, command] = match;
    toolCalls.push({
      tool: "browser_action",
      args: { command: command.trim() },
    });
  }

  return toolCalls;
}
