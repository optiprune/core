import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const JEST_CONFIG_BASENAMES = [
  "jest.config.js",
  "jest.config.ts",
  "jest.config.cjs",
  "jest.config.mjs",
  "jest.config.mts",
  "jest.config.cts",
  "jest.config.json",
  "jest.setup.js",
  "jest.setup.ts",
  "jest.setup.cjs",
  "jest.setup.mjs",
  "jest.setup.mts",
  "jest.setup.cts",
];
const JEST_CORE_PACKAGES = ["jest", "@nx/jest"];

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function dependencyNames(packageJson: any): Set<string> {
  return new Set(Object.keys({
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
  }));
}

function isJestScript(script: string): boolean {
  return /(?:^|[\s&|;])jest(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?jest\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?jest\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?jest\b/.test(script);
}

function isJestConfig(fileId: string): boolean {
  return JEST_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

function isJestTestFile(fileId: string): boolean {
  const normalized = normalize(fileId);
  return normalized.includes(".test.")
    || normalized.includes(".spec.")
    || normalized.includes("/__tests__/")
    || normalized.includes("/__mocks__/");
}

function isModuleReference(value: string): boolean {
  return !value.startsWith(".") && !value.startsWith("/") && !value.startsWith("<rootDir>");
}

/**
 * Jest configurations and scripts are valid runtime evidence even when a test
 * project has no direct source import from `jest`. Generic test globals are not
 * used as dependency evidence because Vitest and other runners share them.
 */
export const JestPlugin: AnalyzerPlugin = {
  name: "jest-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    const dependencies = dependencyNames(packageJson);
    if (JEST_CORE_PACKAGES.some((packageName) => dependencies.has(packageName)) || !!packageJson?.jest) return true;

    for (const configFile of JEST_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(JEST_CONFIG_BASENAMES)).length > 0) return true;
    if (await adapter.folderExists("__tests__")) return true;

    return Object.values(packageJson?.scripts ?? {}).some((script) => typeof script === "string" && isJestScript(script));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const dependencies = dependencyNames(packageJson);
      const configFiles = await adapter.findFiles(JEST_CONFIG_BASENAMES);
      const hasInlineConfig = !!packageJson?.jest;
      const hasTestsDirectory = await adapter.folderExists("__tests__");
      const isNxProject = await adapter.folderExists("nx.json");
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);
      if (hasInlineConfig) adapter.markAsUsed("package.json", "jest");
      if (hasTestsDirectory) adapter.markAsUsed("__tests__");

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isJestScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      const hasEvidence = configFiles.length > 0 || hasInlineConfig || hasTestsDirectory || hasScriptInvocation;
      if (hasEvidence && dependencies.has("jest")) adapter.markPackageAsUsed("jest");
      if (hasEvidence && isNxProject && dependencies.has("@nx/jest")) adapter.markPackageAsUsed("@nx/jest");

      if (hasEvidence && !JEST_CORE_PACKAGES.some((packageName) => dependencies.has(packageName))) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Jest configuration, tests, or command found, but neither 'jest' nor '@nx/jest' is listed in package.json.",
          evidence: { configFiles, hasInlineConfig, hasTestsDirectory, hasScriptInvocation, isNxProject },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isJestConfig(fileId) || isJestTestFile(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "jest" || source.startsWith("jest/") || source === "@jest/globals" || source.startsWith("@jest/")) {
          adapter.markPackageAsUsed(source === "@jest/globals" ? "@jest/globals" : "jest");
          adapter.markAsUsed(fileId);
        }
      }

      if (!isJestConfig(fileId)) return;
      if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");
      if (
        t.isAssignmentExpression(node)
        && t.isMemberExpression(node.left)
        && t.isIdentifier(node.left.object)
        && node.left.object.name === "module"
        && t.isIdentifier(node.left.property)
        && node.left.property.name === "exports"
      ) {
        adapter.markAsUsed(fileId);
      }

      if (node.type !== "ObjectProperty" && node.type !== "Property") return;
      const key = t.isIdentifier(node.key) ? node.key.name : t.isStringLiteral(node.key) ? node.key.value : undefined;
      if (!key || !["setupFiles", "setupFilesAfterEnv", "preset", "testEnvironment"].includes(key)) return;

      const values = t.isArrayExpression(node.value)
        ? node.value.elements.filter(t.isStringLiteral).map((element: any) => element.value)
        : t.isStringLiteral(node.value) ? [node.value.value] : [];
      for (const value of values) {
        if (isModuleReference(value)) adapter.markPackageAsUsed(value);
        else adapter.markAsUsed(value);
      }
    },
  },
};

export default JestPlugin;
