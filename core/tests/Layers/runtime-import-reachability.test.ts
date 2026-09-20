import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/layers/runtime-import-reachability",
);
const findingsFor = (report: any, rule: string, suffix: string) =>
  report.findings.filter((finding: any) => finding.rule === rule && finding.file.endsWith(suffix));

describe("Layer 4 runtime import reachability", () => {
  it("keeps the observed dynamic import target reachable and reports dead siblings", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["main.mjs"],
      extensions: [".mjs"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: false },
    });

    expect(findingsFor(report, "unreachable-file", "live.mjs")).toHaveLength(0);
    expect(findingsFor(report, "unreachable-file", "dead.mjs")).not.toHaveLength(0);
    expect(report.findings.some((finding: any) => finding.rule === "unknown-dynamic-import")).toBe(
      false,
    );
  });
});
