import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("yorkie plugin", () => {
  it("analyzes Git hooks and their TypeScript source graph", async () => {
    const report = await analyzeFixture("yorkie", ["src/index.ts"]);
    expect(report.entryPoints).toContain("src/index.ts");
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
