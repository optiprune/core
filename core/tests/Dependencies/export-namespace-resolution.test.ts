import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/dependencies/export-namespace-resolution",
);
const findingsFor = (report: any, rule: string, suffix: string) =>
  report.findings.filter((finding: any) => finding.rule === rule && finding.file.endsWith(suffix));

describe("Namespace and wildcard export dependencies", () => {
  it("propagates namespace member usage through a barrel without retaining dead exports", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["main.mjs"],
      extensions: [".mjs"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: false },
    });

    expect(findingsFor(report, "unreachable-file", "source.mjs")).toHaveLength(0);
    expect(
      findingsFor(report, "unused-export", "source.mjs").some((finding: any) =>
        finding.message.includes("dead"),
      ),
    ).toBe(true);
  });
});
