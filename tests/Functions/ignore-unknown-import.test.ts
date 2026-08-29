import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("ignoreUnknownImport", () => {
  it("does not classify dynamic-scan files as maybe-reachable", async () => {
    const rootDir = path.join(__dirname, "..", "fixtures", "dynamic-scan-test");
    const report = await analyze({
      rootDir,
      entry: ["entry.ts"],
      extensions: [".ts"],
      ignore: [],
      reportUnusedExports: true,
      includeConventionalEntries: false,
      ignoreUnknownImport: true,
    });

    expect(
      report.findings.some(
        (finding) => finding.file.includes("plugin-a.ts") && finding.rule === "unreachable-file",
      ),
    ).toBe(true);
    expect(
      report.findings.some(
        (finding) => finding.file.includes("plugin-b.ts") && finding.rule === "unreachable-file",
      ),
    ).toBe(true);
    expect(report.findings.some((finding) => finding.rule === "unknown-dynamic-import")).toBe(
      false,
    );
  });
});
