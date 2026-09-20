import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/layers/node-loader-reachability",
);
const findingsFor = (report: any, rule: string, suffix: string) =>
  report.findings.filter((finding: any) => finding.rule === rule && finding.file.endsWith(suffix));

describe("Layer 4 Node runtime-loader reachability", () => {
  it("recognizes Worker URL and aliased createRequire file edges", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["main.mjs"],
      extensions: [".mjs", ".cjs"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: false },
    });

    expect(findingsFor(report, "unreachable-file", "worker.mjs")).toHaveLength(0);
    expect(findingsFor(report, "unreachable-file", "side-effect.cjs")).toHaveLength(0);
    expect(findingsFor(report, "unreachable-file", "not-a-loader.cjs")).not.toHaveLength(0);
  });
});
