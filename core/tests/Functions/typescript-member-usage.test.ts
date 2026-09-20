import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/functions/typescript-member-usage",
);
const findingsFor = (report: any, rule: string, suffix: string) =>
  report.findings.filter((finding: any) => finding.rule === rule && finding.file.endsWith(suffix));

describe("TypeScript member usage analysis", () => {
  it("retains namespace and factory-return members that are actually read", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["main.ts"],
      extensions: [".ts", ".js"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: false },
    });

    expect(
      findingsFor(report, "unused-export", "toolkit.ts").filter((finding: any) =>
        finding.message.includes("'live'"),
      ),
    ).toHaveLength(0);
    expect(
      findingsFor(report, "unused-member", "factory.ts").filter((finding: any) =>
        finding.message.includes("live"),
      ),
    ).toHaveLength(0);
  });
});
