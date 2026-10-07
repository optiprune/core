import { AnalyzerPlugin, PluginAdapter } from "../types.js";
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

/**
 * Jest resolves a handful of integration modules from a short name by probing a
 * prefixed package first:
 *
 *   runner          -> jest-runner-<name>
 *   testEnvironment -> jest-environment-<name>   (`node` and `jsdom` ship with Jest)
 *   testSequencer   -> jest-sequencer-<name>
 *   watchPlugins    -> jest-watch-<name>
 *
 * Only the long form is installed, so a config that says `testEnvironment:
 * "jsdom"` previously never marked `jest-environment-jsdom` as used. The package
 * was then reported as an unused dependency while the bare short name was
 * reported as an unreachable file that cannot be resolved.
 */
const JEST_SHORT_NAME_PREFIXES: Record<string, string> = {
  runner: "jest-runner-",
  testEnvironment: "jest-environment-",
  testSequencer: "jest-sequencer-",
  watchPlugins: "jest-watch-",
};

/** Config keys whose values name modules Jest itself integrates with. */
const JEST_MODULE_CONFIG_KEYS = new Set([
  "setupFiles",
  "setupFilesAfterEnv",
  "preset",
  ...Object.keys(JEST_SHORT_NAME_PREFIXES),
]);

/** Per-plugin-run state, keyed by the adapter for the current analysis. */
const projectDependenciesByAdapter = new WeakMap<PluginAdapter, Set<string>>();

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function dependencyNames(packageJson: any): Set<string> {
  return new Set(
    Object.keys({
      ...packageJson?.dependencies,
      ...packageJson?.devDependencies,
      ...packageJson?.peerDependencies,
    }),
  );
}

function isJestScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])jest(?:\s|$)/.test(script) ||
    /\bnpx\s+(?:--yes\s+)?jest\b/.test(script) ||
    /\bpnpm\s+(?:exec\s+)?jest\b/.test(script) ||
    /\byarn\s+(?:dlx\s+)?jest\b/.test(script)
  );
}

function isJestConfig(fileId: string): boolean {
  return JEST_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

function isJestTestFile(fileId: string): boolean {
  const normalized = normalize(fileId);
  return (
    normalized.includes(".test.") ||
    normalized.includes(".spec.") ||
    normalized.includes("/__tests__/") ||
    normalized.includes("/__mocks__/")
  );
}

function isModuleReference(value: string): boolean {
  return !value.startsWith(".") && !value.startsWith("/") && !value.startsWith("<rootDir>");
}

function packageRoot(specifier: string): string {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }
  return specifier.split("/")[0] ?? specifier;
}

/**
 * Candidate packages for a Jest integration value.
 *
 * A short name yields the prefixed package first and the literal name second,
 * so a declared prefixed package wins. Anything that already carries the prefix
 * (or is scoped/sub-path qualified) is left untouched.
 */
export function jestModuleCandidates(value: string, prefix?: string): string[] {
  if (!prefix) return [value];
  if (value.startsWith(prefix) || value.startsWith("@")) return [value];
  const slash = value.indexOf("/");
  if (slash === -1) return [`${prefix}${value}`, value];
  return [`${prefix}${value.slice(0, slash)}${value.slice(slash)}`, value];
}

/** Flattens string literals out of a config value, including nested arrays. */
function collectStringValues(value: unknown, collected: string[]): void {
  if (t.isStringLiteral(value)) {
    collected.push((value as any).value);
    return;
  }
  if (t.isArrayExpression(value)) {
    for (const element of (value as any).elements) collectStringValues(element, collected);
  }
}

/**
 * Jest configurations and scripts are valid runtime evidence even when a test
 * project has no direct source import from `jest`. Generic test globals are not
 * used as dependency evidence because Vitest and other runners share them.
 */
export const JestPlugin: AnalyzerPlugin = {
  name: "jest-plugin",
  version: "1.4.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    const dependencies = dependencyNames(packageJson);
    if (
      JEST_CORE_PACKAGES.some((packageName) => dependencies.has(packageName)) ||
      !!packageJson?.jest
    )
      return true;

    for (const configFile of JEST_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(JEST_CONFIG_BASENAMES)).length > 0) return true;
    if (await adapter.folderExists("__tests__")) return true;

    return Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isJestScript(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const dependencies = dependencyNames(packageJson);
      projectDependenciesByAdapter.set(adapter, dependencies);
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

      const hasEvidence =
        configFiles.length > 0 || hasInlineConfig || hasTestsDirectory || hasScriptInvocation;
      if (hasEvidence && dependencies.has("jest")) adapter.markPackageAsUsed("jest");
      if (hasEvidence && isNxProject && dependencies.has("@nx/jest"))
        adapter.markPackageAsUsed("@nx/jest");

      if (hasEvidence && !JEST_CORE_PACKAGES.some((packageName) => dependencies.has(packageName))) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Jest configuration, tests, or command found, but neither 'jest' nor '@nx/jest' is listed in package.json.",
          evidence: {
            configFiles,
            hasInlineConfig,
            hasTestsDirectory,
            hasScriptInvocation,
            isNxProject,
          },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isJestConfig(fileId) || isJestTestFile(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "jest" ||
          source.startsWith("jest/") ||
          source === "@jest/globals" ||
          source.startsWith("@jest/")
        ) {
          adapter.markPackageAsUsed(source === "@jest/globals" ? "@jest/globals" : "jest");
          adapter.markAsUsed(fileId);
        }
      }

      if (!isJestConfig(fileId)) return;
      if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");
      if (
        t.isAssignmentExpression(node) &&
        t.isMemberExpression(node.left) &&
        t.isIdentifier(node.left.object) &&
        node.left.object.name === "module" &&
        t.isIdentifier(node.left.property) &&
        node.left.property.name === "exports"
      ) {
        adapter.markAsUsed(fileId);
      }

      if (node.type !== "ObjectProperty" && node.type !== "Property") return;
      const key = t.isIdentifier(node.key)
        ? node.key.name
        : t.isStringLiteral(node.key)
          ? node.key.value
          : undefined;
      if (!key || !JEST_MODULE_CONFIG_KEYS.has(key)) return;

      const prefix = JEST_SHORT_NAME_PREFIXES[key];
      const values: string[] = [];
      collectStringValues(node.value, values);

      for (const value of values) {
        // Project-relative paths (<rootDir>-relative or plain relative paths)
        // are file references, not packages.
        if (!isModuleReference(value)) {
          adapter.markAsUsed(value);
          continue;
        }
        const candidates = jestModuleCandidates(value, prefix);
        const projectDependencies = projectDependenciesByAdapter.get(adapter) ?? new Set<string>();
        const selected =
          candidates.find(
            (candidate) =>
              projectDependencies.has(candidate) || projectDependencies.has(packageRoot(candidate)),
          ) ??
          candidates[0] ??
          value;
        adapter.markPackageAsUsed(packageRoot(selected));
      }
    },

    onAnalysisComplete: (adapter) => {
      projectDependenciesByAdapter.delete(adapter);
    },
  },
};

export default JestPlugin;
