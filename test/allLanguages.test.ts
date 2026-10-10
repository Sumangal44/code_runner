import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildCommand } from "../src/commandBuilder.js";
import { resolveExecutor } from "../src/commandResolver.js";
import type { ScriptConfig } from "../src/config.js";

interface PackageJson {
  contributes: {
    configuration: {
      properties: {
        "code-runner.executorMap": { default: Record<string, string> };
        "code-runner.executorMapByFileExtension": { default: Record<string, string> };
      };
    };
  };
}

const packageJsonPath = resolve(__dirname, "../package.json");
const packageJson: PackageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

const executorMap = packageJson.contributes.configuration.properties["code-runner.executorMap"].default;
const executorMapByExt = packageJson.contributes.configuration.properties["code-runner.executorMapByFileExtension"].default;

function createConfig(): ScriptConfig {
  return {
    executorMap,
    executorMapByGlob: {},
    executorMapByFileExtension: executorMapByExt,
    defaultLanguage: "",
    respectShebang: true,
  };
}

describe("All Programming Languages - Command Resolution & Building", () => {
  const config = createConfig();

  describe("Every language in executorMap resolves and builds valid commands", () => {
    for (const [languageId, executor] of Object.entries(executorMap)) {
      it(`resolves and builds command for '${languageId}'`, () => {
        expect(executor).toBeTruthy();
        expect(typeof executor).toBe("string");

        // 1. Resolve executor
        const resolved = resolveExecutor(config, languageId, "", `test.${languageId}`, false);
        expect(resolved).toBeDefined();
        expect(resolved?.executor).toBe(executor);
        expect(resolved?.languageId).toBe(languageId);

        // 2. Build command with sample file
        const codeFile = `/workspace/src/example.${languageId}`;
        const workspaceFolder = "/workspace";
        const finalCommand = buildCommand(executor, {
          codeFile,
          workspaceFolder,
          pythonPath: "python3",
          args: "--test-arg",
        });

        expect(finalCommand).toBeTruthy();
        // Verify core placeholders are properly substituted
        expect(finalCommand).not.toContain("$fileNameWithoutExt");
        expect(finalCommand).not.toContain("$fileName");
        expect(finalCommand).not.toContain("$dirWithoutTrailingSlash");
        expect(finalCommand).not.toContain("$workspaceRoot");
        expect(finalCommand).not.toContain("$fullFileName");
        expect(finalCommand).not.toContain("$fileExt");
        expect(finalCommand).not.toContain("$relativeFile");
        expect(finalCommand).not.toContain("$relativeDir");

        // Verify arguments were included
        expect(finalCommand).toContain("--test-arg");
      });
    }
  });

  describe("Every extension in executorMapByFileExtension resolves and builds valid commands", () => {
    for (const [ext, executor] of Object.entries(executorMapByExt)) {
      it(`resolves and builds command for file extension '${ext}'`, () => {
        expect(executor).toBeTruthy();
        expect(typeof executor).toBe("string");

        // Resolve by extension (with empty languageId)
        const resolved = resolveExecutor(config, "", ext, `script${ext}`, false);
        expect(resolved).toBeDefined();
        expect(resolved?.executor).toBe(executor);

        // Build command with sample file
        const codeFile = `/workspace/src/script${ext}`;
        const workspaceFolder = "/workspace";
        const finalCommand = buildCommand(executor, {
          codeFile,
          workspaceFolder,
          pythonPath: "python3",
          args: "input.txt",
        });

        expect(finalCommand).toBeTruthy();
        expect(finalCommand).not.toContain("$fileNameWithoutExt");
        expect(finalCommand).not.toContain("$fileName");
        expect(finalCommand).not.toContain("$dirWithoutTrailingSlash");
        expect(finalCommand).not.toContain("$workspaceRoot");
        expect(finalCommand).not.toContain("$fullFileName");
        expect(finalCommand).toContain("input.txt");
      });
    }
  });

  describe("Cross-platform Windows path resolution across languages", () => {
    it("handles Windows drives and paths for C++ and Rust", () => {
      const codeFile = "C:\\Projects\\repo\\src\\main.cpp";
      const executor = executorMap["cpp"];
      const command = buildCommand(executor, { codeFile });

      expect(command).toContain("C:\\Projects\\repo\\src");
      expect(command).toContain("main.cpp");
      expect(command).toContain("main");
      expect(command).not.toContain("$dir");
      expect(command).not.toContain("$fileName");
    });
  });
});
