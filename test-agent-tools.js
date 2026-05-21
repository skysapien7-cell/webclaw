import { read_file, write_file, edit_file, list_dir, grep_search, execute_command } from "./src/agents/tools.js";
import { parseToolCalls } from "./src/agents/parser.js";
import { unlink } from "node:fs/promises";
import { join } from "node:path";

async function runTests() {
  console.log("=== Running WebClaw Agent Tools and Parser Tests ===\n");
  
  const tempFileName = `temp_test_file_${Date.now()}.txt`;
  const tempFilePath = join(process.cwd(), tempFileName);
  let failed = false;

  function assert(condition, message) {
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      failed = true;
    } else {
      console.log(`✅ PASS: ${message}`);
    }
  }

  // 1. Test write_file
  try {
    const initialContent = "line 1: hello world\nline 2: test content\nline 3: end of file";
    const writeResult = await write_file(tempFileName, initialContent);
    assert(writeResult.includes(tempFileName), "write_file returned success message referencing file name");
    
    // 2. Test read_file (entire file)
    const readResult = await read_file(tempFileName);
    assert(readResult === initialContent, "read_file returned exact written content");

    // 3. Test read_file with line ranges
    const readLines = await read_file(tempFileName, 2, 3);
    assert(readLines === "line 2: test content\nline 3: end of file", `read_file with range 2-3 returned correct subset: "${readLines}"`);

    // 4. Test edit_file
    const editResult = await edit_file(
      tempFileName,
      "line 2: test content",
      "line 2: modified content"
    );
    assert(editResult === "File successfully edited.", "edit_file returned success message");
    
    const readAfterEdit = await read_file(tempFileName);
    assert(
      readAfterEdit === "line 1: hello world\nline 2: modified content\nline 3: end of file",
      "edit_file correctly modified target block"
    );

    // 5. Test list_dir
    const listResult = await list_dir(".");
    assert(listResult.includes(tempFileName), "list_dir output contains the temporary test file");

    // 6. Test grep_search
    const grepResult = await grep_search("modified content", ".");
    assert(grepResult.includes(tempFileName) && grepResult.includes("modified content"), "grep_search found the pattern in the test file");

    // 7. Test execute_command
    const cmdResult = await execute_command("node -e \"console.log('hello from child process')\"");
    assert(cmdResult.code === 0, "execute_command successfully ran with code 0");
    assert(cmdResult.stdout.trim() === "hello from child process", "execute_command captured stdout correctly");

  } catch (err) {
    console.error("❌ Unexpected Error during tools test:", err);
    failed = true;
  } finally {
    // Cleanup
    try {
      await unlink(tempFilePath);
      console.log(`Cleaned up temporary test file: ${tempFileName}`);
    } catch (err) {
      console.warn("Could not delete temporary test file:", err.message);
    }
  }

  console.log("\n=== Testing Parser (parseToolCalls) ===\n");

  // 8. Test parsing of XML tool calls
  const testResponseXml = `
Some conversational thoughts here.

1. Read file format A:
<read_file path="src/index.js" start="10" end="20" />

2. Read file format B:
<read_file>src/history.js</read_file>

3. Write file:
<write_file path="scratch/test.js">
console.log("hello");
</write_file>

4. Edit file:
<edit_file path="src/index.js">
<search>
const a = 1;
</search>
<replace>
const a = 2;
</replace>
</edit_file>

5. Execute command:
<execute_command>
npm run chat
</execute_command>

6. List dir format A:
<list_dir />

7. List dir format B:
<list_dir>src</list_dir>

8. Grep search format A:
<grep_search pattern="StreamFilter" path="src/agents" />

9. Grep search format B:
<grep_search pattern="StreamFilter2">src/agents</grep_search>
`;

  const parsedCalls = parseToolCalls(testResponseXml);
  
  // Debug output
  console.log("Parsed calls count:", parsedCalls.length);

  assert(parsedCalls.length === 9, `Expected 9 tool calls, parsed: ${parsedCalls.length}`);
  
  if (parsedCalls.length >= 9) {
    // Verify Read File A
    assert(
      parsedCalls[0].tool === "read_file" && 
      parsedCalls[0].args.path === "src/index.js" && 
      parsedCalls[0].args.startLine === 10 && 
      parsedCalls[0].args.endLine === 20,
      "Parsed read_file format A correctly"
    );

    // Verify Read File B
    assert(
      parsedCalls[1].tool === "read_file" && 
      parsedCalls[1].args.path === "src/history.js" && 
      parsedCalls[1].args.startLine === null && 
      parsedCalls[1].args.endLine === null,
      "Parsed read_file format B correctly"
    );

    // Verify Write File
    assert(
      parsedCalls[2].tool === "write_file" && 
      parsedCalls[2].args.path === "scratch/test.js" && 
      parsedCalls[2].args.content.trim() === 'console.log("hello");',
      "Parsed write_file correctly"
    );

    // Verify Edit File
    assert(
      parsedCalls[3].tool === "edit_file" && 
      parsedCalls[3].args.path === "src/index.js" && 
      parsedCalls[3].args.targetContent.trim() === "const a = 1;" &&
      parsedCalls[3].args.replacementContent.trim() === "const a = 2;",
      "Parsed edit_file correctly"
    );

    // Verify Execute Command
    assert(
      parsedCalls[4].tool === "execute_command" && 
      parsedCalls[4].args.command === "npm run chat",
      "Parsed execute_command correctly"
    );

    // Verify List Dir A
    assert(
      parsedCalls[5].tool === "list_dir" && 
      parsedCalls[5].args.path === ".",
      "Parsed list_dir format A correctly"
    );

    // Verify List Dir B
    assert(
      parsedCalls[6].tool === "list_dir" && 
      parsedCalls[6].args.path === "src",
      "Parsed list_dir format B correctly"
    );

    // Verify Grep Search A
    assert(
      parsedCalls[7].tool === "grep_search" && 
      parsedCalls[7].args.pattern === "StreamFilter" &&
      parsedCalls[7].args.path === "src/agents",
      "Parsed grep_search format A correctly"
    );

    // Verify Grep Search B
    assert(
      parsedCalls[8].tool === "grep_search" && 
      parsedCalls[8].args.pattern === "StreamFilter2" &&
      parsedCalls[8].args.path === "src/agents",
      "Parsed grep_search format B correctly"
    );
  }

  if (failed) {
    console.error("\n❌ Some tests FAILED.");
    process.exit(1);
  } else {
    console.log("\n✨ All tests PASSED successfully!");
    process.exit(0);
  }
}

runTests();
