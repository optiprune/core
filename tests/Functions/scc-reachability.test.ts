import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("SCC Reachability Analysis", () => {
  it("should correctly identify isolated components and cycles as unreachable", async () => {
    const rootDir = path.join(__dirname, "..", "fixtures", "scc-test");
    const report = await analyze({
      rootDir,
      entry: ["entry.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
      includeConventionalEntries: false,
    });

    // 1. reachable.ts should NOT be flagged as unreachable
    const reachableFinding = report.findings.find(
      (f) => f.file.includes("reachable.ts") && f.rule === "unreachable-file",
    );
    expect(reachableFinding).toBeUndefined();

    // 2. isolated-a.ts and isolated-b.ts should be flagged as an isolated cycle
    const findingA = report.findings.find(
      (f) => f.file.includes("isolated-a.ts") && f.rule === "unreachable-file",
    );
    const findingB = report.findings.find(
      (f) => f.file.includes("isolated-b.ts") && f.rule === "unreachable-file",
    );

    expect(findingA).toBeDefined();
    expect(findingA?.message).toContain("isolated cycle");
    expect(findingA?.evidence.isCycle).toBe(true);
    expect(findingA?.evidence.componentSize).toBe(2);

    expect(findingB).toBeDefined();
    expect(findingB?.message).toContain("isolated cycle");
    expect(findingB?.evidence.componentId).toBe(findingA?.evidence.componentId);

    // 3. isolated-c.ts should be flagged as an isolated component (single node)
    const findingC = report.findings.find(
      (f) => f.file.includes("isolated-c.ts") && f.rule === "unreachable-file",
    );
    expect(findingC).toBeDefined();
    expect(findingC?.message).toContain("isolated component");
    expect(findingC?.evidence.isCycle).toBe(false);
    expect(findingC?.evidence.componentSize).toBe(1);
  });
});
