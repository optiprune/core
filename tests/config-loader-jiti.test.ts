import { afterEach, describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "../src/config-loader.js";
import { analyze } from "../src/index.js";

const temporaryRoots: string[] = [];

async function createProject(name: string): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), `optiprune-${name}-`));
  temporaryRoots.push(rootDir);
  return rootDir;
}

async function write(rootDir: string, relativePath: string, content: string): Promise<void> {
  const targetPath = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((rootDir) => fs.rm(rootDir, { recursive: true, force: true })));
});

describe("Jiti configuration loading", () => {
  it("resolves project tsconfig aliases in optiprune.config.ts", async () => {
    const rootDir = await createProject("jiti-alias");
    await write(rootDir, "package.json", JSON.stringify({ name: "jiti-alias", private: true }));
    await write(rootDir, "tsconfig.json", JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: { "@config/*": ["config/*"] },
      },
    }));
    await write(rootDir, "config/values.ts", "export const ignored = ['generated/**'];\n");
    await write(rootDir, "optiprune.config.ts", [
      "import { ignored } from '@config/values';",
      "export default { ignore: ignored, failOn: 'none' };",
    ].join("\n"));

    await expect(loadConfig(rootDir)).resolves.toMatchObject({
      ignore: ["generated/**"],
      failOn: "none",
    });
  });

  it("does not reuse a stale TypeScript config during subsequent analysis requests", async () => {
    const rootDir = await createProject("jiti-cache");
    await write(rootDir, "package.json", JSON.stringify({ name: "jiti-cache", private: true }));
    await write(rootDir, "optiprune.config.ts", "export default { ignore: ['first/**'] };\n");

    await expect(loadConfig(rootDir)).resolves.toMatchObject({ ignore: ["first/**"] });

    await write(rootDir, "optiprune.config.ts", "export default { ignore: ['second/**'] };\n");

    await expect(loadConfig(rootDir)).resolves.toMatchObject({ ignore: ["second/**"] });
  });

  it("loads and resolves every public Config field", async () => {
    const rootDir = await createProject("all-config-fields");
    await write(rootDir, "package.json", JSON.stringify({ name: "all-config-fields", private: true }));
    await write(rootDir, "optiprune.config.ts", [
      "export default {",
      "  rootDir: '.',",
      "  entry: ['src/entry.ts'],",
      "  extensions: ['.ts', '.custom'],",
      "  ignore: ['generated/**'],",
      "  ignoreDependencies: ['manual-runtime-dependency'],",
      "  externalContracts: ['PublicContract'],",
      "  reportUnusedExports: false,",
      "  reportUnusedExportsInUnreachableFiles: true,",
      "  includeConventionalEntries: false,",
      "  includeEntryExports: true,",
      "  cycles: true,",
      "  ignoreTests: true,",
      "  ignoreUnknownImport: true,",
      "  failOn: 'low',",
      "  json: true,",
      "  output: 'sarif',",
      "  verbose: true,",
      "  fix: { confidence: 'medium+', rules: ['files', 'dependencies'], force: true, dryRun: true },",
      "  layers: { smtTimeoutMs: 250, isolateMemoryLimitMb: 48, enableConcolicProof: false, skip3: true, skip4: true },",
      "  rules: { 'unused-export': 'off', 'unreachable-file': 'error' },",
      "  plugins: { 'vitest-plugin': false, 'nextjs-plugin': true },",
      "};",
    ].join("\n"));

    const loaded = await loadConfig(rootDir);
    const resolved = mergeConfig({
      ...DEFAULT_CONFIG,
      rootDir,
      pathAliases: new Map(),
      packageImports: new Map(),
      packageIgnoreDependencies: new Map(),
      layers: { ...DEFAULT_CONFIG.layers },
      rules: { ...DEFAULT_CONFIG.rules },
      plugins: { ...DEFAULT_CONFIG.plugins },
    }, loaded);

    expect(loaded).toMatchObject({
      rootDir: ".",
      entry: ["src/entry.ts"],
      extensions: [".ts", ".custom"],
      ignore: ["generated/**"],
      ignoreDependencies: ["manual-runtime-dependency"],
      externalContracts: ["PublicContract"],
      reportUnusedExports: false,
      reportUnusedExportsInUnreachableFiles: true,
      includeConventionalEntries: false,
      includeEntryExports: true,
      cycles: true,
      ignoreTests: true,
      ignoreUnknownImport: true,
      failOn: "low",
      json: true,
      output: "sarif",
      verbose: true,
      fix: { confidence: "medium+", rules: ["files", "dependencies"], force: true, dryRun: true },
      layers: { smtTimeoutMs: 250, isolateMemoryLimitMb: 48, enableConcolicProof: false, skip3: true, skip4: true },
      rules: { "unused-export": "off", "unreachable-file": "error" },
      plugins: { "vitest-plugin": false, "nextjs-plugin": true },
    });
    expect(resolved).toMatchObject({
      rootDir,
      entry: [path.join(rootDir, "src/entry.ts")],
      extensions: [".ts", ".custom"],
      ignoreDependencies: ["manual-runtime-dependency"],
      externalContracts: ["PublicContract"],
      reportUnusedExports: false,
      reportUnusedExportsInUnreachableFiles: true,
      includeConventionalEntries: false,
      includeEntryExports: true,
      cycles: true,
      ignoreTests: true,
      ignoreUnknownImport: true,
      failOn: "low",
      json: false,
      output: "sarif",
      verbose: true,
      fix: { confidence: "medium+", rules: ["files", "dependencies"], force: true, dryRun: true },
      layers: { smtTimeoutMs: 250, isolateMemoryLimitMb: 48, enableConcolicProof: false, skip3: true, skip4: true },
      rules: expect.objectContaining({ "unused-export": "off", "unreachable-file": "error" }),
      plugins: { "vitest-plugin": false, "nextjs-plugin": true },
    });
    expect(resolved.ignore).toEqual(expect.arrayContaining(["generated/**"]));
  });

  it("ignores every file below test-like directories, including package.json", async () => {
    const rootDir = await createProject("ignore-tests-complete");
    await write(rootDir, "package.json", JSON.stringify({ name: "ignore-tests-complete", private: true }));
    await write(rootDir, "src/index.ts", "export const live = true;\n");
    await write(rootDir, "tests/nested/dead.ts", "export const dead = true;\n");
    await write(rootDir, "tests/nested/package.json", JSON.stringify({ dependencies: { "unused-test-dependency": "1.0.0" } }));
    await write(rootDir, "src/widget.spec.ts", "export const deadSpec = true;\n");
    await write(rootDir, "src/fixtures/data.ts", "export const fixture = true;\n");
    await write(rootDir, "optiprune.config.ts", "export default { entry: ['src/index.ts'], ignoreTests: true, failOn: 'none' };\n");

    const report = await analyze({ rootDir, layers: { skip3: true, skip4: true } });

    expect(report.findings.some((finding) => /(^|[/\\\\])(test|tests|spec|specs|fixtures|__tests__)([/\\\\]|$)|(?:^|[.])(test|spec)[.]/i.test(path.relative(rootDir, String(finding.file))))).toBe(false);
    expect(report.findings.some((finding) => String(finding.evidence?.package) === "unused-test-dependency")).toBe(false);
  });

  it("treats dynamically registered AnalyzerPlugin object members as used", async () => {
    const rootDir = await createProject("plugin-contract-members");
    await write(rootDir, "package.json", JSON.stringify({ name: "plugin-contract-members", private: true }));
    await write(rootDir, "src/index.ts", "import { XoPlugin } from './plugins/xo-plugin';\nvoid XoPlugin;\n");
    await write(rootDir, "src/plugins/xo-plugin.ts", [
      "export const XoPlugin = {",
      "  name: 'xo-plugin',",
      "  version: '1.0.0',",
      "  detect: async () => true,",
      "  lifecycle: {},",
      "};",
    ].join("\\n"));

    const report = await analyze({ rootDir, layers: { skip3: true, skip4: true } });
    expect(report.findings.filter((finding) => finding.rule === "unused-member")).toEqual([]);
  });

  it("applies imported ignore patterns and ignoreDependencies to analysis", async () => {
    const rootDir = await createProject("jiti-options");
    await write(rootDir, "package.json", JSON.stringify({
      name: "jiti-options",
      private: true,
      dependencies: {
        "ignored-lib": "1.0.0",
        "unused-lib": "1.0.0",
      },
      devDependencies: {
        "ignored-dev-lib": "1.0.0",
      },
    }));
    await write(rootDir, "src/index.ts", "export const used = true;\n");
    await write(rootDir, "src/ignored-folder/dead.ts", "export const dead = true;\n");
    await write(rootDir, "config-values.ts", [
      "export const ignoredDirectories = ['src/ignored-folder/**'];",
      "export const ignoredDependencies = ['ignored-lib', 'ignored-dev-lib'];",
    ].join("\n"));
    await write(rootDir, "optiprune.config.ts", [
      "import { ignoredDependencies, ignoredDirectories } from './config-values.ts';",
      "export default {",
      "  entry: ['src/index.ts'],",
      "  ignore: ignoredDirectories,",
      "  ignoreDependencies: ignoredDependencies,",
      "  failOn: 'none',",
      "  layers: { skip3: true, skip4: true },",
      "};",
    ].join("\n"));

    const report = await analyze({ rootDir, layers: { skip3: true, skip4: true } });
    const unusedPackages = report.findings
      .filter((finding) => finding.rule === "unused-dependency" || finding.rule === "unused-dev-dependency")
      .map((finding) => String(finding.evidence.package));

    assert.deepEqual(unusedPackages, ["unused-lib"]);
    expect(report.findings.some((finding) => String(finding.file).includes("ignored-folder"))).toBe(false);
  });
});
