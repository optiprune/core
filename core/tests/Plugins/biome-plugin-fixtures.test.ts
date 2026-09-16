import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plugins");

async function analyzeFixture(name: string, options: Partial<Parameters<typeof analyze>[0]> = {}) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    extensions: [".js", ".ts", ".json", ".jsonc"],
    includeConventionalEntries: true,
    reportUnusedExports: true,
    ...options,
  });
}

function filesFor(report: Awaited<ReturnType<typeof analyze>>, rule: string) {
  return report.findings.filter((finding) => finding.rule === rule).map((finding) => finding.file);
}

function packageFindings(report: Awaited<ReturnType<typeof analyze>>, packageName: string) {
  return report.findings.filter((finding) => finding.evidence?.package === packageName);
}

describe("Biome plugin fixtures", () => {
  it("parses JSONC and JSON config formats and keeps both configs live", async () => {
    const report = await analyzeFixture("biome-basic-jsonc");
    const unreachable = filesFor(report, "unreachable-file");
    expect(unreachable).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("jsonc/biome.jsonc"),
        expect.stringContaining("json/biome.json"),
      ]),
    );
    expect(packageFindings(report, "@biomejs/biome")).toHaveLength(0);
  });

  it("keeps an external shared config dependency live", async () => {
    const report = await analyzeFixture("biome-extends-pkg");
    expect(packageFindings(report, "@shared/biome-config")).toHaveLength(0);
  });

  it("keeps a relative inherited config live", async () => {
    const report = await analyzeFixture("biome-extends-local");
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("configs/biome.strict.json")]),
    );
  });

  it("handles scoped override include globs without AST or path errors", async () => {
    const report = await analyzeFixture("biome-overrides");
    expect(report.findings.filter((finding) => finding.rule === "plugin-error")).toHaveLength(0);
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("biome.json")]),
    );
  });

  it("finds nested configs and reports a genuinely unused Biome dependency", async () => {
    const report = await analyzeFixture("biome-nested-dead-deps");
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("apps/web/biome.json")]),
    );
    expect(packageFindings(report, "@unused/biome-preset")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "unused-dev-dependency" })]),
    );
  });

  it("accepts a single string in extends", async () => {
    const report = await analyzeFixture("biome-extends-string");
    expect(packageFindings(report, "@my-org/config")).toHaveLength(0);
  });

  it("resolves a parent config from a nested monorepo package", async () => {
    const report = await analyzeFixture("biome-monorepo-root");
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("packages/app/biome.json")]),
    );
  });

  it("follows chained local presets to external shared rules", async () => {
    const report = await analyzeFixture("biome-chained-presets");
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("biome.base.json")]),
    );
    expect(packageFindings(report, "@scope/shared-rules")).toHaveLength(0);
  });

  it("extracts the package name from a scoped extends subpath", async () => {
    const report = await analyzeFixture("biome-subpath-extends");
    expect(packageFindings(report, "@scoped/configs")).toHaveLength(0);
  });

  it("keeps Biome live when invoked through an npm script", async () => {
    const report = await analyzeFixture("biome-cli-scripts");
    expect(packageFindings(report, "@biomejs/biome")).toHaveLength(0);
  });
});
