import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("wrangler plugin", () => {
  it("analyzes the Worker entrypoint and static asset configuration", async () => {
    const report = await analyzeFixture("wrangler", ["src/index.ts"]);
    expect(report.entryPoints).toContain("src/index.ts");
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
