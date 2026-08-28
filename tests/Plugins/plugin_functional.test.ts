import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

describe("Plugin Functional Verification", () => {
  it("should protect Svelte components and store usage", async () => {
    const report = await analyze({
      rootDir,
      entry: [], // Empty entry
      includeConventionalEntries: false,
      reportUnusedExports: true
    });

    // Svelte file itself should be reachable because of onFileStart
    const svelteFile = report.findings.find(f => f.file.includes("svelte-component.svelte") && f.rule === "unreachable-file");
    expect(svelteFile).toBeUndefined();
  });

  it("should protect Angular components and decorators", async () => {
    // We create a dummy angular.json to trigger detection in the test
    const angularJsonPath = path.join(rootDir, 'angular.json');
    await fs.writeFile(angularJsonPath, '{}');

    try {
      const report = await analyze({
        rootDir,
        entry: [], 
        includeConventionalEntries: false,
        reportUnusedExports: true
      });

      const unreachableFile = report.findings.find(f => f.rule === "unreachable-file" && f.file.includes("angular-component.ts"));
      expect(unreachableFile).toBeUndefined();
    } finally {
      await fs.unlink(angularJsonPath).catch(() => {});
    }
  });
});
