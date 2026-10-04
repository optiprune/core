import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/functions/namespace-member-usage",
);

describe("namespace member usage", () => {
  it("preserves the namespace and its used member through TSX analysis", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["main.ts"],
      extensions: [".ts", ".tsx"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    const apiFindings = report.findings.filter((finding) => finding.file.endsWith("src/api.ts"));
    expect(
      apiFindings.some(
        (finding) => finding.rule === "unused-member" && finding.message.includes("hidden"),
      ),
    ).toBe(false);
    expect(
      apiFindings.some(
        (finding) => finding.rule === "unused-member" && finding.message.includes("visible"),
      ),
    ).toBe(false);
    expect(report.findings.some((finding) => finding.file.endsWith("src/view.tsx"))).toBe(false);
  });
});
