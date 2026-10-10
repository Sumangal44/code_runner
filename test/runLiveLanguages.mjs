import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = resolve(__dirname, "..");
const testDir = join(workspaceRoot, ".test_snippets");

if (existsSync(testDir)) {
  rmSync(testDir, { recursive: true, force: true });
}
mkdirSync(testDir, { recursive: true });

const pkg = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf-8"));
const executorMap = pkg.contributes.configuration.properties["code-runner.executorMap"].default;

const snippets = [
  {
    lang: "javascript",
    file: "hello.js",
    code: 'console.log("JavaScript executed successfully!");',
    binary: "node",
  },
  {
    lang: "bun",
    file: "hello_bun.js",
    code: 'console.log("Bun executed successfully!");',
    binary: "bun",
  },
  {
    lang: "c",
    file: "hello.c",
    code: '#include <stdio.h>\nint main(void) { printf("C executed successfully!\\n"); return 0; }',
    binary: "gcc",
  },
  {
    lang: "cpp",
    file: "hello.cpp",
    code: '#include <iostream>\nint main() { std::cout << "C++ executed successfully!" << std::endl; return 0; }',
    binary: "g++",
  },
  {
    lang: "rust",
    file: "hello.rs",
    code: 'fn main() { println!("Rust executed successfully!"); }',
    binary: "rustc",
  },
  {
    lang: "go",
    file: "hello.go",
    code: 'package main\nimport "fmt"\nfunc main() { fmt.Println("Go executed successfully!") }',
    binary: "go",
  },
  {
    lang: "python",
    file: "hello.py",
    code: 'print("Python executed successfully!")',
    binary: "python3",
    customExecutor: "python3 -u",
  },
  {
    lang: "ruby",
    file: "hello.rb",
    code: 'puts "Ruby executed successfully!"',
    binary: "ruby",
  },
  {
    lang: "perl",
    file: "hello.pl",
    code: 'print "Perl executed successfully!\\n";',
    binary: "perl",
  },
  {
    lang: "shellscript",
    file: "hello.sh",
    code: 'echo "Bash executed successfully!"',
    binary: "bash",
  },
  {
    lang: "applescript",
    file: "hello.applescript",
    code: 'return "AppleScript executed successfully!"',
    binary: "osascript",
  },
  {
    lang: "swift",
    file: "hello.swift",
    code: 'print("Swift executed successfully!")',
    binary: "swift",
    checkCmd: "swift -e 'print(1)' 2>/dev/null",
  },
  {
    lang: "zig",
    file: "hello.zig",
    code: 'const std = @import("std");\npub fn main() void {\n    std.debug.print("Zig executed successfully!\\n", .{});\n}',
    binary: "zig",
  },
  {
    lang: "java",
    file: "HelloJava.java",
    code: 'public class HelloJava { public static void main(String[] args) { System.out.println("Java executed successfully!"); } }',
    binary: "javac",
    checkCmd: "java -version 2>/dev/null",
  },
];

console.log("=================================================");
console.log("  CODE RUNNER: LIVE LANGUAGE EXECUTION TEST");
console.log("=================================================\n");

let passedCount = 0;
let skippedCount = 0;
let failedCount = 0;

for (const item of snippets) {
  // Check if binary is available and functional
  let binaryAvailable = false;
  try {
    const testCheck = item.checkCmd || `which ${item.binary} 2>/dev/null`;
    execSync(testCheck, { stdio: "ignore" });
    binaryAvailable = true;
  } catch {
    binaryAvailable = false;
  }

  if (!binaryAvailable) {
    console.log(`[-] [SKIPPED] ${item.lang.padEnd(14)} (${item.binary} not available/configured on system)`);
    skippedCount++;
    continue;
  }

  const filePath = join(testDir, item.file);
  writeFileSync(filePath, item.code, "utf-8");

  const executor = item.customExecutor || executorMap[item.lang];
  const parts = {
    codeFile: filePath,
    workspaceFolder: testDir,
    pythonPath: "python3",
  };

  // Build command using the built-in placeholder replacement
  let cmd = executor
    .replace(/\$workspaceRoot/g, testDir)
    .replace(/\$dir\$fileNameWithoutExt/g, `"${join(testDir, item.file.replace(/\.[^.]+$/, ""))}"`)
    .replace(/\$dir\$fileName/g, `"${join(testDir, item.file)}"`)
    .replace(/\$fileNameWithoutExt/g, item.file.replace(/\.[^.]+$/, ""))
    .replace(/\$fileName/g, item.file)
    .replace(/\$dir/g, `"${testDir}"`)
    .replace(/\$dirWithoutTrailingSlash/g, `"${testDir}"`)
    .replace(/\$pythonPath/g, "python3");

  if (!executor.includes("$fileName") && !executor.includes("$fullFileName")) {
    cmd = `${cmd} "${filePath}"`;
  }

  const start = Date.now();
  try {
    const output = execSync(cmd, { cwd: testDir, encoding: "utf-8", timeout: 15000 });
    const elapsed = Date.now() - start;
    const cleanOutput = output.trim().split("\n")[0];
    console.log(`[+] [PASSED]  ${item.lang.padEnd(14)} (${elapsed}ms) -> "${cleanOutput}"`);
    passedCount++;
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[x] [FAILED]  ${item.lang.padEnd(14)} (${elapsed}ms): ${err.message}`);
    failedCount++;
  }
}

// Cleanup test files
rmSync(testDir, { recursive: true, force: true });

console.log("\n-------------------------------------------------");
console.log(`RESULTS: ${passedCount} PASSED, ${failedCount} FAILED, ${skippedCount} SKIPPED`);
console.log("-------------------------------------------------");

if (failedCount > 0) {
  process.exit(1);
}
