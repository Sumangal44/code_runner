import { describe, expect, it } from "vitest";

import { resolveExecutor } from "../src/commandResolver.js";
import type { ScriptConfig } from "../src/config.js";

function baseConfig(): ScriptConfig {
  return {
    executorMap: {
      javascript: "node",
      python: "python -u",
      shellscript: "bash",
    },
    executorMapByGlob: {},
    executorMapByFileExtension: {
      ".ts": "ts-node",
    },
    defaultLanguage: "",
    respectShebang: true,
  };
}

describe("resolveExecutor", () => {
  it("resolves by language id", () => {
    const result = resolveExecutor(baseConfig(), "javascript", ".js", "a.js", true);
    expect(result?.executor).toBe("node");
  });

  it("resolves by file extension", () => {
    const result = resolveExecutor(baseConfig(), "", ".ts", "a.ts", true);
    expect(result?.executor).toBe("ts-node");
  });

  it("respects the shebang when enabled", () => {
    const config = baseConfig();
    config.shebang = "#!/usr/bin/env node";
    const result = resolveExecutor(config, "javascript", ".js", "a.js", true);
    expect(result?.executor).toBe("/usr/bin/env node");
  });

  it("ignores the shebang when disabled", () => {
    const config = baseConfig();
    config.shebang = "#!/usr/bin/env node";
    const result = resolveExecutor(config, "javascript", ".js", "a.js", false);
    expect(result?.executor).toBe("node");
  });

  it("matches executorMapByGlob before executorMap", () => {
    const config = baseConfig();
    config.executorMapByGlob = { "*.test.js": "tap" };
    const result = resolveExecutor(config, "javascript", ".js", "a.test.js", true);
    expect(result?.executor).toBe("tap");
  });

  it("falls back to the default language", () => {
    const config = baseConfig();
    config.defaultLanguage = "python";
    const result = resolveExecutor(config, "", ".txt", "a.txt", true);
    expect(result?.executor).toBe("python -u");
  });

  it("returns undefined when nothing matches", () => {
    const result = resolveExecutor(baseConfig(), "", ".xyz", "a.xyz", true);
    expect(result).toBeUndefined();
  });
});
