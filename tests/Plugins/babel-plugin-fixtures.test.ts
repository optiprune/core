import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plugins");

async function analyzeFixture(name: string, options: Partial<Parameters<typeof analyze>[0]> = {}) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    extensions: [".js", ".json"],
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

describe("Babel plugin fixtures", () => {
  it.each(["json", "js", "cjs", "package"])(
    "recognizes the %s Babel configuration variation as live",
    async (format) => {
      const report = await analyzeFixture(path.join("babel-configs", format));
      const configName =
        format === "json"
          ? "babel.config.json"
          : format === "js"
            ? ".babelrc.js"
            : format === "cjs"
              ? "babel.config.cjs"
              : "package.json";
      expect(filesFor(report, "unreachable-file")).not.toEqual(
        expect.arrayContaining([expect.stringContaining(configName)]),
      );
      expect(packageFindings(report, "@babel/core")).toHaveLength(0);
    },
  );

  it("expands Babel preset and plugin shorthands to dependency names", async () => {
    const report = await analyzeFixture("babel-shorthands");
    for (const packageName of [
      "@babel/preset-env",
      "babel-preset-react",
      "@babel/plugin-transform-runtime",
      "@scope/babel-plugin-custom",
    ]) {
      expect(packageFindings(report, packageName), packageName).toHaveLength(0);
    }
  });

  it("keeps local Babel plugins and presets referenced by relative paths alive", async () => {
    const report = await analyzeFixture("babel-local-plugins");
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("my-custom-plugin.js"),
        expect.stringContaining("my-custom-preset.js"),
      ]),
    );
  });

  it("extracts module names from preset and plugin tuples with options", async () => {
    const report = await analyzeFixture("babel-tuples-options");
    expect(packageFindings(report, "@babel/preset-env")).toHaveLength(0);
    expect(packageFindings(report, "@babel/plugin-transform-runtime")).toHaveLength(0);
  });

  it("traverses env and overrides configuration branches", async () => {
    const report = await analyzeFixture("babel-env-overrides");
    for (const packageName of [
      "@babel/preset-env",
      "@babel/plugin-transform-runtime",
      "@babel/plugin-transform-arrow-functions",
    ]) {
      expect(packageFindings(report, packageName)).toHaveLength(0);
    }
  });

  it("extracts presets from a function-exported Babel config", async () => {
    const report = await analyzeFixture("babel-functional-config");
    expect(packageFindings(report, "@babel/preset-env")).toHaveLength(0);
    expect(filesFor(report, "unreachable-file")).not.toEqual(
      expect.arrayContaining([expect.stringContaining("babel.config.js")]),
    );
  });

  it("keeps @babel/runtime live when transform-runtime injects helpers implicitly", async () => {
    const report = await analyzeFixture("babel-runtime-injection");
    expect(packageFindings(report, "@babel/plugin-transform-runtime")).toHaveLength(0);
    expect(packageFindings(report, "@babel/runtime")).toHaveLength(0);
  });

  it("flags an undeclared Babel dependency and dead exports in a local plugin", async () => {
    const report = await analyzeFixture("babel-dead-deps");
    expect(packageFindings(report, "@babel/plugin-syntax-jsx")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "unused-dependency" })]),
    );
    const deadExports = report.findings
      .filter(
        (finding) => finding.rule === "unused-export" && finding.file.includes("local-plugin.js"),
      )
      .map((finding) => finding.evidence.exportName);
    expect(deadExports).toEqual(expect.arrayContaining(["deadPluginHelper", "deadPluginConstant"]));
  });
});
