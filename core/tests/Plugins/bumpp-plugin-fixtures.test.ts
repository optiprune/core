import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plugins");

async function analyzeFixture(name: string) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    extensions: [".js", ".ts", ".json"],
    includeConventionalEntries: true,
    reportUnusedExports: true,
  });
}

function packageFindings(report: Awaited<ReturnType<typeof analyze>>, packageName: string) {
  return report.findings.filter((finding) => finding.evidence?.package === packageName);
}

describe("Bumpp plugin fixtures", () => {
  it.each([
    "bumpp-script-default",
    "bumpp-script-flags",
    "bumpp-custom-files",
    "bumpp-chained-script",
  ])("recognizes Bumpp in the %s npm script", async (fixture) => {
    const report = await analyzeFixture(fixture);
    expect(packageFindings(report, "bumpp")).toHaveLength(0);
  });

  it("traces programmatic imports from a custom release script", async () => {
    const report = await analyzeFixture("bumpp-programmatic");
    expect(packageFindings(report, "bumpp")).toHaveLength(0);
    expect(report.findings.filter((finding) => finding.rule === "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("scripts/release.ts")]),
    );
  });

  it("flags Bumpp when it is declared but never invoked", async () => {
    const report = await analyzeFixture("bumpp-unused-dep");
    expect(packageFindings(report, "bumpp")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "unused-dev-dependency" })]),
    );
  });
});
