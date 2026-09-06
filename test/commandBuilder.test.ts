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
});
