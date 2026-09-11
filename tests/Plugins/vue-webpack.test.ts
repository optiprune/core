import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("vue-webpack plugin", () => {
  it("analyzes a legacy Vue app with webpack and vue-loader", async () => {
    const report = await analyzeFixture("vue-webpack", ["src/main.js"]);
    expect(report.entryPoints).toContain("src/main.js");
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
