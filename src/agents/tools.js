import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, resolve, isAbsolute, relative, dirname } from "node:path";
import { exec } from "node:child_process";

const WORKSPACE_DIR = process.cwd();

/**
 * Resolve a path to an absolute path.
 * Allows absolute paths anywhere (the user confirms via approval prompt).
 * Relative paths are resolved relative to the workspace directory.
 */
function safeResolve(filePath) {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(WORKSPACE_DIR, filePath);
  return absolutePath;
}

/**
 * Reads the content of a file.
 */
export async function read_file(filePath, startLine = null, endLine = null) {
  const absPath = safeResolve(filePath);
  const content = await readFile(absPath, "utf8");
  
  if (startLine !== null || endLine !== null) {
    const lines = content.split(/\r?\n/);
    const start = startLine !== null ? Math.max(1, parseInt(startLine, 10)) - 1 : 0;
    const end = endLine !== null ? Math.min(lines.length, parseInt(endLine, 10)) : lines.length;
    return lines.slice(start, end).join("\n");
  }
  
  return content;
}

/**
 * Writes or completely overwrites a file.
 */
export async function write_file(filePath, content) {
  const absPath = safeResolve(filePath);
  // Ensure parent directories exist
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, "utf8");
  return `File successfully written to ${absPath}`;
}

/**
 * Replaces a unique target block in a file with replacement content.
 */
export async function edit_file(filePath, targetContent, replacementContent) {
  const absPath = safeResolve(filePath);
  const content = await readFile(absPath, "utf8");
  
  // Normalize line endings to find match reliably
  const normalize = (str) => str.replace(/\r\n/g, "\n");
  const normalizedContent = normalize(content);
  const normalizedTarget = normalize(targetContent);
  const normalizedReplacement = normalize(replacementContent);
  
  const occurrences = normalizedContent.split(normalizedTarget).length - 1;
  if (occurrences === 0) {
    throw new Error(`Target content not found in file '${relative(WORKSPACE_DIR, absPath)}'. Make sure your target content matches exactly (including whitespace/indentation).`);
  }
  if (occurrences > 1) {
    throw new Error(`Target content matches multiple blocks in file '${relative(WORKSPACE_DIR, absPath)}'. Please make your search block larger or more specific to ensure uniqueness.`);
  }
  
  const updatedContent = normalizedContent.replace(normalizedTarget, normalizedReplacement);
  await writeFile(absPath, updatedContent, "utf8");
  return `File successfully edited.`;
}

/**
 * Lists the contents of a directory.
 */
export async function list_dir(dirPath = ".") {
  const absPath = safeResolve(dirPath);
  const files = await readdir(absPath);
  const results = [];
  
  for (const file of files) {
    // Skip noisy directories
    if (file === "node_modules" || file === ".git" || file === ".gemini") continue;
    
    const filePath = join(absPath, file);
    try {
      const fileStat = await stat(filePath);
      const isDirectory = fileStat.isDirectory();
      results.push({
        name: file,
        type: isDirectory ? "dir" : "file",
        size: isDirectory ? null : fileStat.size,
      });
    } catch {
      // Ignore stat errors for symlinks or unreadable files
    }
  }
  
  if (results.length === 0) return "(directory is empty)";
  
  return results
    .map((r) => `${r.type === "dir" ? "[DIR]" : "     "} ${r.name}${r.size !== null ? ` (${r.size} bytes)` : ""}`)
    .join("\n");
}

/**
 * Searches recursively for a text pattern in the workspace.
 */
export async function grep_search(pattern, dirPath = ".") {
  const absStartPath = safeResolve(dirPath);
  const results = [];
  const regex = new RegExp(pattern, "i");
  
  async function search(currentPath) {
    const files = await readdir(currentPath);
    for (const file of files) {
      if (file === "node_modules" || file === ".git" || file === ".gemini") continue;
      
      const filePath = join(currentPath, file);
      try {
        const fileStat = await stat(filePath);
        if (fileStat.isDirectory()) {
          await search(filePath);
        } else {
          const content = await readFile(filePath, "utf8");
          const lines = content.split(/\r?\n/);
          lines.forEach((line, idx) => {
            if (regex.test(line)) {
              results.push({
                file: relative(WORKSPACE_DIR, filePath),
                line: idx + 1,
                content: line.trim(),
              });
            }
          });
        }
      } catch {
        // ignore
      }
    }
  }
  
  await search(absStartPath);
  
  if (results.length === 0) return "No matches found.";
  
  return results
    .slice(0, 100) // cap at 100 matches to avoid bloating context
    .map((r) => `${r.file}:${r.line}: ${r.content}`)
    .join("\n");
}

/**
 * Runs a command in the workspace directory.
 */
export function execute_command(command, timeoutMs = 30000) {
  return new Promise((resolve) => {
    // Use PowerShell to execute commands so they run in the SAME process
    // tree and we capture output properly (avoids 'start' opening new windows).
    const options = {
      cwd: WORKSPACE_DIR,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
      shell: "powershell.exe",
      windowsHide: true,  // Prevent new console windows from appearing
    };

    exec(command, options, (error, stdout, stderr) => {
      resolve({
        code: error ? error.code || 1 : 0,
        stdout: stdout || "",
        stderr: stderr || "",
      });
    });
  });
}

/**
 * Runs an agent-browser CLI command for browser automation.
 * The command is the subcommand + args (e.g. "open https://example.com", "snapshot", "click @e3").
 */
export function browser_action(command, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const fullCommand = `agent-browser ${command}`;
    const options = {
      cwd: WORKSPACE_DIR,
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024, // 2MB — snapshots can be large
      shell: "powershell.exe",
      windowsHide: true,
    };

    exec(fullCommand, options, (error, stdout, stderr) => {
      resolve({
        code: error ? error.code || 1 : 0,
        stdout: stdout || "",
        stderr: stderr || "",
      });
    });
  });
}
