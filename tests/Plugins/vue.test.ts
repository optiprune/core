import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("vue plugin", () => {
  it.each([
    ["vue", "src/App.vue"],
    ["vue-styles", "src/App.vue"],
  ])("analyzes the %s SFC project", async (fixture, entry) => {
    const report = await analyzeFixture(fixture, [entry]);
    expect(report.entryPoints).toContain(entry);
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});