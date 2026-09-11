import { describe, expect, it } from "vitest";
import { analyzeFixture } from "./fixture-utils.js";

describe("wxt plugin", () => {
  it("analyzes extension background, content, and popup entrypoints", async () => {
    const report = await analyzeFixture("wxt", [
      "entrypoints/background.ts",
      "entrypoints/content.ts",
      "entrypoints/popup/main.ts",
    ]);
    expect(report.entryPoints).toEqual(
      expect.arrayContaining([
        "entrypoints/background.ts",
        "entrypoints/content.ts",
        "entrypoints/popup/main.ts",
      ]),
    );
    expect(report.summary.filesParsed).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);
  });
});
