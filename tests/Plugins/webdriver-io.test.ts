import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("webdriver-io plugin", () => {
  it("analyzes the WebdriverIO config and e2e spec", async () => {
    const report = await analyzeFixture("webdriver-io", ["test/specs/home.e2e.ts"]);
    expect(report.entryPoints).toContain("test/specs/home.e2e.ts");
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
