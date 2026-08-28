import { describe, it, expect } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Dynamic Scan & Import Heuristic (Fix 2)", () => {
  it("should mark files in scanned directories as maybe-reachable when dynamic imports are present", async () => {
    const rootDir = path.join(__dirname, "..","fixtures", "dynamic-scan-test");
    const report = await analyze({
      rootDir,
      entry: ["entry.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
      includeConventionalEntries: false,
    });

    // 1. loader.ts should be reachable
    const loaderUnreachable = report.findings.find(f => f.file.includes("loader.ts") && f.rule === "unreachable-file");
    expect(loaderUnreachable).toBeUndefined();

    // 2. plugin-a.ts and plugin-b.ts should NOT be flagged as unreachable-file 
    // because they are in a scanned directory and there is a dynamic import pattern.
    // They should be in the maybeReachable set.
    const pluginAUnreachable = report.findings.find(f => f.file.includes("plugin-a.ts") && f.rule === "unreachable-file");
    const pluginBUnreachable = report.findings.find(f => f.file.includes("plugin-b.ts") && f.rule === "unreachable-file");

    expect(pluginAUnreachable).toBeUndefined();
    expect(pluginBUnreachable).toBeUndefined();
  });
});
