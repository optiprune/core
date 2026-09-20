import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";
import { parseModule } from "../../src/parser.js";
import { readFile } from "node:fs/promises";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/functions/commonjs-loader-resolution",
);
const findingsFor = (report: any, rule: string, suffix: string) =>
  report.findings.filter((finding: any) => finding.rule === rule && finding.file.endsWith(suffix));

describe("CommonJS loader resolution", () => {
  it("tracks destructured require members and ignores shadowed require calls", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["main.cjs"],
      extensions: [".cjs"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: false },
    });

    expect(findingsFor(report, "unreachable-file", "library.cjs")).toHaveLength(0);
    expect(
      findingsFor(report, "unused-export", "library.cjs").some((finding: any) =>
        finding.message.includes("dead"),
      ),
    ).toBe(true);
    expect(findingsFor(report, "unreachable-file", "not-a-loader.cjs")).not.toHaveLength(0);
  });

  it("ignores path.resolve and Promise.resolve without creating dependency edges", async () => {
    const source = await readFile(path.join(fixtureRoot, "resolve-call.mjs"), "utf8");
    const parsed = parseModule(source, path.join(fixtureRoot, "resolve-call.mjs"));
    expect(parsed.edges.filter((edge) => edge.kind === "dynamic-literal")).toHaveLength(0);
    expect(parsed.edges.filter((edge) => edge.resolution === "resolved")).toHaveLength(0);
    expect(
      parsed.edges.every(
        (edge) => edge.kind !== "dynamic-literal" && edge.resolution !== "resolved",
      ),
    ).toBe(true);
  });
});
