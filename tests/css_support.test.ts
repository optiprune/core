import { analyze } from "../src/index.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";

describe("First-class stylesheet support", () => {
  it("resolves JS-to-CSS imports and counts CSS package imports as used", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-css-"));

    try {
      await fs.writeFile(
        path.join(rootDir, "package.json"),
        JSON.stringify({
          name: "css-support-fixture",
          dependencies: {
            "tw-animate-css": "1.0.0",
            "unused-css-package": "1.0.0",
          },
        }),
      );
      await fs.writeFile(path.join(rootDir, "main.ts"), 'import "./index.css";\n');
      await fs.writeFile(
        path.join(rootDir, "index.css"),
        '@import "tw-animate-css";\n@import "./theme.css";\nbody { color: black; }\n',
      );
      await fs.writeFile(path.join(rootDir, "theme.css"), ":root { --brand: black; }\n");
      await fs.writeFile(path.join(rootDir, "unused.css"), ".unused { display: none; }\n");

      const report = await analyze({
        rootDir,
        entry: ["main.ts"],
        includeConventionalEntries: false,
        reportUnusedExports: false,
      });

      expect(report.summary.filesDiscovered).toBe(4);
      expect(report.summary.filesParsed).toBe(4);
      expect(report.findings.some((finding) => finding.rule === "unresolved-import")).toBe(false);
      expect(report.findings.some((finding) => finding.rule === "unreachable-file" && finding.file.endsWith("unused.css"))).toBe(true);
      expect(report.findings.some((finding) => finding.evidence?.package === "tw-animate-css")).toBe(false);
      expect(report.findings.some((finding) => finding.evidence?.package === "unused-css-package")).toBe(true);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
