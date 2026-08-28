import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "optiprune-regressions");

async function writeFixture(relativePath: string, content: string): Promise<void> {
  const target = path.join(fixtureRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function writePackage(packageJson: Record<string, unknown>): Promise<void> {
  await writeFixture("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function analyzeFixture(options: Partial<Parameters<typeof analyze>[0]> = {}) {
  return analyze({
    rootDir: fixtureRoot,
    entry: [],
    extensions: [".ts", ".tsx", ".mjs", ".json"],
    includeConventionalEntries: false,
    ...options,
  });
}

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("OptiPrune regressions", () => {
  it("does not let knip.json project patterns shrink Core discovery", async () => {
    await writePackage({ name: "knip-isolation", private: true });
    await writeFixture("knip.json", JSON.stringify({
      entry: ["src/main.ts"],
      project: ["src/main.ts"],
    }));
    await writeFixture("src/main.ts", "export const main = true;\n");
    await writeFixture("src/also-discoverable.ts", "export const extra = true;\n");

    const report = await analyzeFixture({ entry: ["src/main.ts"], extensions: [".ts"] });

    expect(report.summary.filesDiscovered).toBe(2);
    expect(report.summary.filesParsed).toBe(2);
  });

  it("marks every imported ESLint flat-config plugin and TypeScript resolver as used", async () => {
    await writePackage({
      name: "eslint-flat-config",
      private: true,
      devDependencies: {
        eslint: "9.0.0",
        "@eslint/js": "9.0.0",
        "eslint-plugin-import": "2.0.0",
        "eslint-plugin-react": "7.0.0",
        "eslint-import-resolver-typescript": "3.0.0",
        "typescript-eslint": "8.0.0",
      },
    });
    await writeFixture("eslint.config.mjs", [
      "import eslint from '@eslint/js';",
      "import importPlugin from 'eslint-plugin-import';",
      "import react from 'eslint-plugin-react';",
      "import tseslint from 'typescript-eslint';",
      "export default [{ plugins: { import: importPlugin, react },",
      "  languageOptions: { parser: tseslint.parser },",
      "  settings: { 'import/resolver': { typescript: true } },",
      "  rules: eslint.configs.recommended.rules }];",
    ].join("\n"));

    const report = await analyzeFixture({ entry: ["eslint.config.mjs"], extensions: [".mjs"] });
    const unused = report.findings
      .filter((finding) => finding.rule === "unused-dev-dependency")
      .map((finding) => finding.evidence.package);

    expect(unused).not.toEqual(expect.arrayContaining([
      "@eslint/js",
      "eslint-plugin-import",
      "eslint-plugin-react",
      "eslint-import-resolver-typescript",
      "typescript-eslint",
    ]));
  });

  it("resolves a binary from a same-named npm script through a dependency bin field", async () => {
    await writePackage({
      name: "bin-script-resolution",
      private: true,
      scripts: { optiprune: "optiprune" },
      devDependencies: { "@optiprune/cli": "1.2.23" },
    });
    await writeFixture("node_modules/@optiprune/cli/package.json", JSON.stringify({
      name: "@optiprune/cli",
      bin: { optiprune: "dist/cli.js" },
    }));

    const report = await analyzeFixture();

    expect(report.findings.some((finding) =>
      finding.rule === "unused-dev-dependency" && finding.evidence.package === "@optiprune/cli"
    )).toBe(false);
    expect(report.findings.some((finding) =>
      finding.rule === "missing-dependency" && finding.evidence.package === "optiprune"
    )).toBe(false);
  });

  it("protects the OptiPrune Core, CLI, and binary package names", async () => {
    await writePackage({
      name: "optiprune-whitelist",
      private: true,
      devDependencies: {
        "@optiprune/core": "1.11.58",
        "@optiprune/cli": "1.2.23",
        optiprune: "1.0.0",
      },
    });

    const report = await analyzeFixture();
    const unused = report.findings
      .filter((finding) => finding.rule === "unused-dev-dependency")
      .map((finding) => finding.evidence.package);

    expect(unused).not.toEqual(expect.arrayContaining([
      "@optiprune/core",
      "@optiprune/cli",
      "optiprune",
    ]));
  });

  it("does not report members read from an imported factory return type or typed destructuring", async () => {
    await writePackage({ name: "member-usage", private: true });
    await writeFixture("src/config.ts", [
      "export interface Config { name: string; color: string }",
      "export function createConfig(): Config { return { name: 'demo', color: 'blue' }; }",
    ].join("\n"));
    await writeFixture("src/app.ts", [
      "import { createConfig } from './config';",
      "import type { Config } from './config';",
      "const config = createConfig();",
      "export function render({ name, color }: Config): string { return `${name}:${color}:${config.name}:${config.color}`; }",
    ].join("\n"));

    const report = await analyzeFixture({ entry: ["src/app.ts"], extensions: [".ts"], reportUnusedExports: true });

    expect(report.findings.some((finding) => finding.rule === "unused-member")).toBe(false);
  });
});
