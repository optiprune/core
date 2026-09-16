import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plugins");

async function analyzeFixture(name: string) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    extensions: [".js", ".ts"],
    includeConventionalEntries: true,
    reportUnusedExports: true,
  });
}

function findingFiles(report: Awaited<ReturnType<typeof analyze>>, rule: string) {
  return report.findings.filter((finding) => finding.rule === rule).map((finding) => finding.file);
}

describe("AVA plugin fixtures", () => {
  it("uses default AVA test conventions as entry roots and keeps test imports alive", async () => {
    const report = await analyzeFixture("ava-defaults");
    expect(findingFiles(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("test.js"),
        expect.stringContaining("nested.test.js"),
      ]),
    );
    expect(findingFiles(report, "unused-export")).toEqual(
      expect.arrayContaining([expect.stringContaining("helper.js")]),
    );
    expect(report.findings.some((finding) => finding.evidence?.package === "ava")).toBe(false);
  });

  it("honors AVA config files globs and does not treat the config as dead code", async () => {
    const report = await analyzeFixture("ava-custom-globs");
    expect(findingFiles(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("ava.config.js"),
        expect.stringContaining("spec/custom.test.ts"),
        expect.stringContaining("src/custom-helper.js"),
      ]),
    );
    expect(findingFiles(report, "unreachable-file")).toEqual(
      expect.arrayContaining([expect.stringContaining("not-a-test.js")]),
    );
  });

  it("keeps AVA require helpers and their dependencies live", async () => {
    const report = await analyzeFixture("ava-require-helpers");
    expect(findingFiles(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("test/_setup.js"),
        expect.stringContaining("shared/setup-helper.js"),
        expect.stringContaining("test/worker.test.js"),
      ]),
    );
  });

  it("reports untouched exports from an imported AVA helper", async () => {
    const report = await analyzeFixture("ava-dead-exports");
    const deadExports = report.findings
      .filter((finding) => finding.rule === "unused-export" && finding.file.includes("helper.js"))
      .map((finding) => finding.evidence.exportName);
    expect(deadExports).toEqual(expect.arrayContaining(["bar", "baz"]));
    expect(deadExports).not.toContain("foo");
  });
});
