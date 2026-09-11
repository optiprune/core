import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("xo plugin", () => {
  it("analyzes the TypeScript source under inline XO configuration", async () => {
    const report = await analyzeFixture("xo", ["src/index.ts"]);
    expect(report.entryPoints).toContain("src/index.ts");
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
