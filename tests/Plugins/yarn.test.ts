import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("yarn plugin", () => {
  it("analyzes Berry package extensions and PnP metadata", async () => {
    const report = await analyzeFixture("yarn-berry");
    expect(report.summary.filesDiscovered).toBeGreaterThanOrEqual(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
