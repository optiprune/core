import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("webpack plugin", () => {
  it.each([
    ["webpack", ["src/index.js"]],
    ["webpack2", []],
    ["webpack-cli", ["src/main.js"]],
    ["webpack-entry-function", ["src/app.js", "src/admin.js"]],
    ["webpack-entry-import", ["src/main.js", "src/vendor.js", "src/runtime.js"]],
    ["webpack-reexport", ["src/index.js"]],
    ["webpack-ts-config", ["src/index.ts"]],
  ])("analyzes the %s configuration and source graph", async (fixture, entry) => {
    const report = await analyzeFixture(fixture, entry);
    for (const expectedEntry of entry) expect(report.entryPoints).toContain(expectedEntry);
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});