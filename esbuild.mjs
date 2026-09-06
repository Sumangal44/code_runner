import { build, context } from "esbuild";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

// Type-check the whole project before bundling.
execFileSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" });

if (watch) {
  rmSync("dist", { recursive: true, force: true });
  const ctx = await context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    target: "node18",
    platform: "node",
    external: ["vscode"],
    sourcemap: !production,
    minify: production,
    outfile: "dist/extension.js",
    logLevel: "info",
  });
  await ctx.watch();
  console.log("Watching src/** for changes...");
} else {
  rmSync("dist", { recursive: true, force: true });
  await build({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    target: "node18",
    platform: "node",
    external: ["vscode"],
    sourcemap: !production,
    minify: production,
    outfile: "dist/extension.js",
    logLevel: "info",
  });
}
