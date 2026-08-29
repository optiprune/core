import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { analyze } from "../../src/index.js";

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-whole-file-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "import './orphan.ts';\nimport './script.ts';\nexport const entry = true;\n",
  );
  await fs.writeFile(
    path.join(root, "src", "orphan.ts"),
    "export const module1 = { source: 'examples/hello', n: 1 };\n",
  );
  await fs.writeFile(
    path.join(root, "src", "script.ts"),
    "console.log('runtime side effect');\nexport const module2 = { source: 'examples/hello', n: 2 };\n",
  );
  return root;
}

describe("whole-file unused export reporting", () => {
  it("reports a pure export-only file as unreachable but preserves files with runtime logic", async () => {
    const root = await createFixture();
    try {
      const report = await analyze({
        rootDir: root,
        entry: ["src/index.ts"],
        includeConventionalEntries: false,
        reportUnusedExports: true,
        layers: { skip3: true, skip4: true },
      });
      expect(
        report.findings.some(
          (finding) =>
            finding.rule === "unreachable-file" && finding.file.endsWith("src/orphan.ts"),
        ),
      ).toBe(true);
      expect(
        report.findings.some(
          (finding) =>
            finding.rule === "unused-export" &&
            finding.file.endsWith("src/orphan.ts") &&
            finding.evidence?.exportName === "module1",
        ),
      ).toBe(true);
      expect(
        report.findings.some(
          (finding) =>
            finding.rule === "unreachable-file" && finding.file.endsWith("src/script.ts"),
        ),
      ).toBe(false);
      expect(
        report.findings.some(
          (finding) =>
            finding.rule === "unused-export" &&
            finding.file.endsWith("src/script.ts") &&
            finding.evidence?.exportName === "module2",
        ),
      ).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
