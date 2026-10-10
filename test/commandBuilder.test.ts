import { describe, expect, it } from "vitest";

import {
  buildCommand,
  replacePlaceholders,
  splitFilePath,
} from "../src/commandBuilder.js";

describe("splitFilePath", () => {
  it("splits a POSIX path", () => {
    const parts = splitFilePath("/home/user/code/hello.js");
    expect(parts.dir).toBe("/home/user/code");
    expect(parts.baseName).toBe("hello.js");
    expect(parts.baseNameWithoutExt).toBe("hello");
    expect(parts.driveLetter).toBe("$driveLetter");
  });

  it("splits a Windows path and extracts the drive letter", () => {
    const parts = splitFilePath("C:\\Users\\user\\code\\hello.js");
    expect(parts.driveLetter).toBe("C:");
    expect(parts.baseName).toBe("hello.js");
  });

  it("handles paths without an extension", () => {
    const parts = splitFilePath("/tmp/build");
    expect(parts.baseNameWithoutExt).toBe("build");
    expect(parts.fileExt).toBe("");
  });

  it("extracts relative file and relative directory", () => {
    const parts = splitFilePath("/repo/src/components/app.tsx", "/repo");
    expect(parts.relativeFile).toBe("src/components/app.tsx");
    expect(parts.relativeDir).toBe("src/components");
    expect(parts.fileExt).toBe("tsx");
    expect(parts.baseName).toBe("app.tsx");
    expect(parts.baseNameWithoutExt).toBe("app");
  });
});

describe("replacePlaceholders", () => {
  const codeFile = "/home/user/code/hello.js";

  it("replaces $dir with a quoted directory", () => {
    expect(replacePlaceholders("cd $dir && node", { codeFile })).toBe(
      'cd "/home/user/code" && node',
    );
  });

  it("replaces $fileNameWithOutExt without quoting", () => {
    expect(replacePlaceholders("node $fileNameWithoutExt", { codeFile })).toBe(
      "node hello",
    );
  });

  it("replaces $fileNameWithExt and $fileExt", () => {
    expect(replacePlaceholders("run $fileNameWithExt --ext=$fileExt", { codeFile })).toBe(
      "run hello.js --ext=js",
    );
  });

  it("replaces $relativeFile and $relativeDir", () => {
    expect(
      replacePlaceholders("run $relativeFile in $relativeDir", {
        codeFile: "/repo/src/index.ts",
        workspaceFolder: "/repo",
      }),
    ).toBe("run src/index.ts in src");
  });

  it("replaces $cwd with quoted working directory", () => {
    expect(replacePlaceholders("cd $cwd", { codeFile, cwd: "/home/user/custom" })).toBe(
      'cd "/home/user/custom"',
    );
  });

  it("replaces $args and $arguments", () => {
    expect(replacePlaceholders("node $fileName $args", { codeFile, args: "--port 3000" })).toBe(
      "node hello.js --port 3000",
    );
    expect(replacePlaceholders("node $fileName $arguments", { codeFile, args: "--dev" })).toBe(
      "node hello.js --dev",
    );
  });

  it("replaces environment variables via $env:VAR and ${env:VAR}", () => {
    expect(
      replacePlaceholders("echo $env:MY_VAR ${env:OTHER_VAR}", {
        codeFile,
        env: { MY_VAR: "foo", OTHER_VAR: "bar" },
      }),
    ).toBe("echo foo bar");
  });

  it("replaces $fullFileName and $fileName", () => {
    expect(replacePlaceholders("run $fullFileName", { codeFile })).toBe(
      'run "/home/user/code/hello.js"',
    );
    expect(replacePlaceholders("run $fileName", { codeFile })).toBe("run hello.js");
  });

  it("replaces $workspaceRoot with the workspace folder", () => {
    expect(
      replacePlaceholders("cd $workspaceRoot", { codeFile, workspaceFolder: "/repo" }),
    ).toBe("cd /repo");
  });

  it("replaces $pythonPath with the resolved interpreter", () => {
    expect(
      replacePlaceholders("$pythonPath -u $fileName", {
        codeFile,
        pythonPath: "/usr/bin/python3",
      }),
    ).toBe("/usr/bin/python3 -u hello.js");
  });
});

describe("buildCommand", () => {
  const codeFile = "/home/user/code/hello.js";

  it("substitutes placeholders in place", () => {
    expect(buildCommand("node $fileName", { codeFile })).toBe("node hello.js");
  });

  it("appends the file name when no placeholder is present", () => {
    expect(buildCommand("node", { codeFile })).toBe('node "/home/user/code/hello.js"');
  });

  it("does not append the file name when appendFile is false", () => {
    expect(buildCommand("echo Hello", { codeFile }, false)).toBe("echo Hello");
  });

  it("returns the executor unchanged when there is no code file", () => {
    expect(buildCommand("echo Hello", {})).toBe("echo Hello");
  });

  it("appends arguments when args provided without placeholder in executor", () => {
    expect(buildCommand("node $fileName", { codeFile, args: "arg1 arg2" })).toBe(
      "node hello.js arg1 arg2",
    );
  });

  it("does not duplicate arguments when $args placeholder was used", () => {
    expect(buildCommand("node $fileName $args", { codeFile, args: "arg1 arg2" })).toBe(
      "node hello.js arg1 arg2",
    );
  });

  it("builds cross-platform Swift command on POSIX and Windows", () => {
    // POSIX path
    const posixCmd = buildCommand("swift", { codeFile: "/Users/dev/project/hello.swift" });
    expect(posixCmd).toBe('swift "/Users/dev/project/hello.swift"');

    // Windows path
    const winCmd = buildCommand("swift", { codeFile: "C:\\Projects\\SwiftApp\\main.swift" });
    expect(winCmd).toBe('swift "C:\\Projects\\SwiftApp\\main.swift"');
  });

  it("builds cross-platform Java command on POSIX and Windows", () => {
    const javaExecutor = "cd $dir && javac $fileName && java $fileNameWithoutExt";

    // POSIX
    const posixJava = buildCommand(javaExecutor, { codeFile: "/Users/dev/project/Hello.java" });
    expect(posixJava).toBe('cd "/Users/dev/project" && javac Hello.java && java Hello');

    // Windows
    const winJava = buildCommand(javaExecutor, { codeFile: "C:\\Projects\\JavaApp\\Hello.java" });
    expect(winJava).toBe('cd "C:\\Projects\\JavaApp" && javac Hello.java && java Hello');
  });

  it("replaces $dir$fileNameWithoutExt with native path separators on Windows and POSIX", () => {
    const cExecutor = "cd $dir && gcc $fileName -o $fileNameWithoutExt && $dir$fileNameWithoutExt";

    // POSIX
    const posixC = buildCommand(cExecutor, { codeFile: "/Users/dev/code/main.c" });
    expect(posixC).toBe('cd "/Users/dev/code" && gcc main.c -o main && "/Users/dev/code/main"');

    // Windows
    const winC = buildCommand(cExecutor, { codeFile: "C:\\Projects\\code\\main.c" });
    expect(winC).toBe('cd "C:\\Projects\\code" && gcc main.c -o main && "C:\\Projects\\code\\main"');
  });
});
