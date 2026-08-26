import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyze } from "../src/index.js";
import { applyFixes } from "../src/fixer.js";
import type { AnalysisReport, Finding } from "../src/types.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function report(findings: Finding[]): AnalysisReport {
  return {
    version: "test", rootDir: "/tmp", entryPoints: [], findings,
    summary: { filesDiscovered: 0, filesParsed: 0, filesRecovered: 0, filesFallback: 0, edges: 0, entryPoints: 0, stronglyConnectedComponents: 0, cycles: 0, findings: findings.length, errors: 0, warnings: findings.length },
    modules: [], components: [],
  };
}

function unusedExport(file: string, exportName: string, confidence: Finding["confidence"] = "high"): Finding {
  return { rule: "unused-export", severity: "warning", confidence, message: "unused", file, evidence: { exportName } };
}

async function rootWith(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-options-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  return root;
}

describe("new analysis options", () => {
  it("does not report exports in an entry file unless includeEntryExports is enabled", async () => {
    const root = await rootWith({
      "package.json": "{\"main\": \"src/index.ts\"}\n",
      "src/index.ts": "export const publicValue = 1;\nexport const deadValue = 2;\n",
    });
    const normal = await analyze({ rootDir: root, skip3: true, skip4: true });
    expect(normal.findings.some((f) => f.rule === "unused-export" && f.evidence.exportName === "deadValue")).toBe(false);
    const enabled = await analyze({ rootDir: root, includeEntryExports: true, skip3: true, skip4: true });
    expect(enabled.findings.some((f) => f.rule === "unused-export" && f.evidence.exportName === "deadValue")).toBe(true);
  });

  it("does not report members of dynamically imported modules", async () => {
    const root = await rootWith({
      "src/index.ts": "const loaded = await import('./dynamic-module');\nconsole.log(loaded);\n",
      "src/dynamic-module.ts": "export const runtimeConfig = { onlyLoadedDynamically: true };\n",
    });
    const result = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      skip3: true,
      skip4: true,
    });
    expect(result.findings.some((finding) =>
      finding.rule === "unused-member" && finding.evidence.memberName === "onlyLoadedDynamically",
    )).toBe(false);
  });

  it("does not report members declared in configuration files", async () => {
    const root = await rootWith({
      "tool.config.ts": "export const config = { consumedByTool: true };\n",
    });
    const result = await analyze({
      rootDir: root,
      entry: ["tool.config.ts"],
      includeConventionalEntries: false,
      includeEntryMembers: true,
      skip3: true,
      skip4: true,
    });
    expect(result.findings.some((finding) => finding.rule === "unused-member")).toBe(false);
  });

  it("reports entry-point members only when includeEntryMembers is enabled", async () => {
    const root = await rootWith({
      "src/index.ts": "export const publicConfig = { externallyVisible: true };\n",
    });
    const normal = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      skip3: true,
      skip4: true,
    });
    expect(normal.findings.some((finding) => finding.rule === "unused-member")).toBe(false);

    const enabled = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      includeConventionalEntries: false,
      includeEntryMembers: true,
      skip3: true,
      skip4: true,
    });
    expect(enabled.findings.some((finding) =>
      finding.rule === "unused-member" && finding.evidence.memberName === "externallyVisible",
    )).toBe(true);
  });

  it("ignores test files when ignoreTests is enabled", async () => {
    const root = await rootWith({
      "src/index.ts": "import './helper';\nexport const entry = true;\n",
      "src/helper.ts": "export const helper = true;\n",
      "src/foo.test.ts": "export const testOnly = true;\n",
      "src/__tests__/nested.ts": "export const nested = true;\n",
      "tests/fixtures/ignored-package/package.json": "{\"name\":\"ignored-test-package\"}\n",
      "tests/fixtures/ignored-package/optiprune.config.ts": "throw new Error('test config must not be loaded');\\n",
    });
    const normal = await analyze({ rootDir: root, entry: ["src/index.ts"], includeConventionalEntries: false, skip3: true, skip4: true });
    expect(normal.summary.filesDiscovered).toBeGreaterThan(2);
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ignored = await analyze({ rootDir: root, entry: ["src/index.ts"], includeConventionalEntries: false, ignoreTests: true, skip3: true, skip4: true });
    expect(ignored.summary.filesDiscovered).toBe(2);
    expect(warningSpy).not.toHaveBeenCalledWith(expect.stringContaining("test config must not be loaded"));
    warningSpy.mockRestore();
    expect(ignored.modules.some((m) => m.path.includes("foo.test.ts"))).toBe(false);
  });
});

describe("export fixer syntax", () => {
  it.each([".js", ".jsx", ".ts", ".tsx", ".vue"])("supports %s", async (extension) => {
    const file = `src/component${extension}`;
    const root = await rootWith({ [file]: "export const dead = 1;\n" });
    expect(await applyFixes(report([unusedExport(file, "dead")]), root, { rules: ["exports"], confidence: "high" })).toBe(1);
    expect(await fs.readFile(path.join(root, file), "utf8")).toBe("");
  });

  it("removes only export when a symbol is used in the same file", async () => {
    const file = "src/local.tsx";
    const root = await rootWith({ [file]: "export const used = 1;\nconsole.log(used);\n" });
    expect(await applyFixes(report([unusedExport(file, "used")]), root, { rules: ["exports"] })).toBe(1);
    expect(await fs.readFile(path.join(root, file), "utf8")).toBe("const used = 1;\nconsole.log(used);\n");
  });

  it("removes a middle export-list item and its preceding comma", async () => {
    const file = "src/list.vue";
    const root = await rootWith({ [file]: "<script setup lang=\"ts\">\nconst one = 1;\nconst two = 2;\nconst three = 3;\nexport { one, two, three };\n</script>\n" });
    expect(await applyFixes(report([unusedExport(file, "two")]), root, { rules: ["exports"] })).toBe(1);
    expect(await fs.readFile(path.join(root, file), "utf8")).toContain("export { one, three };");
  });
});
