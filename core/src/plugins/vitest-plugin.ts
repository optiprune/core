import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import {
  loadStaticPluginConfig,
  stringArray,
  stringRecord,
  type StaticConfigValue,
} from "../plugin-config.js";
import path from "pathe";

/**
 * Vitest root per config file, captured while the static config is parsed.
 * `onASTNode` runs later without access to the parsed config, but it resolves
 * `setupFiles` and needs the same root.
 */
const vitestRootsByConfigFile = new Map<string, string>();

const VITEST_CONFIG_BASENAMES = [
  "vitest.config.ts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vitest.config.cjs",
  "vitest.config.mts",
  "vitest.config.cts",
  "vitest.workspace.ts",
  "vitest.workspace.js",
  "vitest.workspace.mjs",
  "vitest.workspace.cjs",
  "vitest.workspace.json",
  // Vite/Vitest share configuration, but a Vite config is only treated as
  // Vitest configuration when its parsed object contains a `test` section.
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
];

const VITEST_PACKAGE = "vitest";

const ENVIRONMENT_PACKAGES: Record<string, string> = {
  jsdom: "jsdom",
  "happy-dom": "happy-dom",
};

const COVERAGE_PACKAGES: Record<string, string> = {
  v8: "@vitest/coverage-v8",
  istanbul: "@vitest/coverage-istanbul",
};

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function dependencyNames(packageJson: any): Set<string> {
  return new Set(
    Object.keys({
      ...packageJson?.dependencies,
      ...packageJson?.devDependencies,
      ...packageJson?.peerDependencies,
      ...packageJson?.optionalDependencies,
    }),
  );
}

function isVitestScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])vitest(?:\s|$)/.test(script) ||
    /\bnpx\s+(?:--yes\s+)?vitest\b/.test(script) ||
    /\bpnpm\s+(?:exec\s+)?vitest\b/.test(script) ||
    /\byarn\s+(?:dlx\s+)?vitest\b/.test(script)
  );
}

function isVitestConfig(fileId: string): boolean {
  return VITEST_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

function isSharedViteConfig(fileId: string): boolean {
  return /^vite\.config\./.test(path.basename(normalize(fileId)));
}

function isVitestTestFile(fileId: string): boolean {
  const normalized = normalize(fileId);
  return (
    normalized.includes(".test.") ||
    normalized.includes(".spec.") ||
    normalized.includes(".bench.") ||
    normalized.includes("/__tests__/") ||
    normalized.startsWith("tests/") ||
    normalized.startsWith("test/")
  );
}

function configuredEnvironment(config: Record<string, StaticConfigValue>): string | undefined {
  const test = stringRecord(config.test);
  return typeof test.environment === "string" ? test.environment : undefined;
}

function configuredCoverageProvider(config: Record<string, StaticConfigValue>): string | undefined {
  const test = stringRecord(config.test);
  const coverage = stringRecord(test.coverage);
  return typeof coverage.provider === "string" ? coverage.provider : undefined;
}

function hasVitestConfigSection(config: Record<string, StaticConfigValue>): boolean {
  return Object.keys(stringRecord(config.test)).length > 0;
}

function declaredPackage(
  adapter: {
    markPackageAsUsed(packageName: string): void;
  },
  dependencies: Set<string>,
  packageName: string,
): boolean {
  if (!dependencies.has(packageName)) return false;
  adapter.markPackageAsUsed(packageName);
  return true;
}

function shouldInspectConfig(
  configFile: string,
  config: Record<string, StaticConfigValue>,
): boolean {
  // A plain Vite config is not evidence that Vitest is installed or used.
  // Inspect it only when the static config actually exposes a `test` block.
  return !isSharedViteConfig(configFile) || hasVitestConfigSection(config);
}

/**
 * Vitest resolves its project root as `test.root || root || cwd`
 * (`packages/vitest/src/node/plugins/index.ts`). `setupFiles`, `include` and the
 * scan directory are relative to that root, not to the config file. Reading only
 * `test.root` made a config that sets `root: "packages/app"` resolve everything
 * from the project directory.
 *
 * Without a working-directory hint, an absent or relative root is anchored at
 * the config directory, which is where Vite resolves config-relative paths.
 */
export function resolveVitestRoot(
  configFile: string,
  config: Record<string, StaticConfigValue>,
): string {
  const configDirectory = path.dirname(normalize(configFile));
  const test = stringRecord(config.test);
  const configured =
    (typeof test.root === "string" && test.root.trim().length > 0 ? test.root : undefined) ??
    (typeof config.root === "string" && config.root.trim().length > 0 ? config.root : undefined);
  if (!configured) return configDirectory;
  return path.isAbsolute(configured) ? configured : path.join(configDirectory, configured);
}

function isModuleReference(value: string): boolean {
  return !value.startsWith(".") && !path.isAbsolute(value) && !value.startsWith("<");
}

/**
 * Entry patterns for the files Vitest actually runs, rebased to the Vitest root.
 * `test.include` defaults to `**\/*.{test,spec}.?(c|m)[jt]s?(x)`, but the default
 * is left to the framework heuristic; only explicit configuration is applied here
 * so a project that never narrowed its scope keeps the broader detection.
 */
function vitestEntryPatterns(
  configFile: string,
  config: Record<string, StaticConfigValue>,
): string[] {
  const test = stringRecord(config.test);
  const vitestRoot = resolveVitestRoot(configFile, config);
  const patterns: string[] = [];
  for (const include of stringArray(test.include)) {
    patterns.push(path.isAbsolute(include) ? include : path.join(vitestRoot, include));
  }
  if (typeof test.dir === "string" && test.dir.trim().length > 0) {
    const directory = path.isAbsolute(test.dir) ? test.dir : path.join(vitestRoot, test.dir);
    patterns.push(path.join(directory, "**"));
  }
  return patterns;
}

/**
 * Vitest loads test environments from configuration rather than a source
 * import. This plugin checks statically readable config before package-use
 * analysis and emits a diagnostic when the configured environment or coverage
 * provider is not declared.
 */
export const VitestPlugin: AnalyzerPlugin = {
  name: "vitest-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    const dependencies = dependencyNames(packageJson);

    if (dependencies.has(VITEST_PACKAGE)) return true;

    for (const configFile of VITEST_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    if ((await adapter.findFiles(VITEST_CONFIG_BASENAMES)).length > 0) {
      return true;
    }

    if (await adapter.folderExists("__tests__")) return true;

    return Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isVitestScript(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const dependencies = dependencyNames(packageJson);
      const configFiles = await adapter.findFiles(VITEST_CONFIG_BASENAMES);
      const hasTestsDirectory = await adapter.folderExists("__tests__");
      let hasScriptInvocation = false;

      for (const configFile of configFiles) {
        adapter.markAsUsed(configFile);
      }

      if (hasTestsDirectory) {
        adapter.markAsUsed("__tests__");
      }

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isVitestScript(script)) continue;

        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      const parsedConfigs: Array<{
        file: string;
        config: Record<string, StaticConfigValue>;
        source: string;
      }> = [];

      for (const configFile of configFiles) {
        const loaded = await loadStaticPluginConfig(adapter, [configFile]);
        if (!loaded) continue;
        if (!shouldInspectConfig(configFile, loaded.config)) continue;

        parsedConfigs.push({
          file: configFile,
          config: loaded.config,
          source: loaded.source,
        });
      }

      const hasVitestConfig = parsedConfigs.length > 0;
      const hasVitestEvidence = hasVitestConfig || hasTestsDirectory || hasScriptInvocation;

      if (hasVitestEvidence && dependencies.has(VITEST_PACKAGE)) {
        adapter.markPackageAsUsed(VITEST_PACKAGE);
      }

      if (hasVitestEvidence && !dependencies.has(VITEST_PACKAGE)) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Vitest configuration, tests, or command found, but 'vitest' is not listed in package.json.",
          evidence: {
            configFiles,
            hasTestsDirectory,
            hasScriptInvocation,
          },
        });
      }

      for (const loaded of parsedConfigs) {
        const vitestRoot = resolveVitestRoot(loaded.file, loaded.config);
        vitestRootsByConfigFile.set(normalize(loaded.file), vitestRoot);
        const testSection = stringRecord(loaded.config.test);

        // `setupFiles` are relative to the Vitest root, not to the config file.
        for (const setupFile of stringArray(testSection.setupFiles)) {
          if (isModuleReference(setupFile)) {
            adapter.markPackageAsUsed(setupFile);
            continue;
          }
          adapter.markAsUsed(
            path.isAbsolute(setupFile) ? setupFile : path.join(vitestRoot, setupFile),
          );
        }

        // Files Vitest actually runs are analysis roots; without this a project
        // that narrows `test.include` (or sets a scan `dir`) reports its suites
        // as unreachable.
        const entryPatterns = vitestEntryPatterns(loaded.file, loaded.config);
        if (entryPatterns.length > 0) adapter.addEntryPatterns(entryPatterns);

        const environment = configuredEnvironment(loaded.config);
        const environmentPackage = environment ? ENVIRONMENT_PACKAGES[environment] : undefined;

        if (environmentPackage) {
          if (!declaredPackage(adapter, dependencies, environmentPackage)) {
            adapter.emitFinding({
              rule: "missing-dependency",
              severity: "error",
              confidence: "high",
              file: "package.json",
              message: `Vitest config '${loaded.source}' sets environment '${environment}', but '${environmentPackage}' is not listed in package.json.`,
              evidence: {
                configSource: loaded.source,
                environment,
                packageName: environmentPackage,
              },
            });
          }
        }

        const provider = configuredCoverageProvider(loaded.config);
        const coveragePackage = provider ? COVERAGE_PACKAGES[provider] : undefined;

        if (coveragePackage) {
          if (!declaredPackage(adapter, dependencies, coveragePackage)) {
            adapter.emitFinding({
              rule: "missing-dependency",
              severity: "error",
              confidence: "high",
              file: "package.json",
              message: `Vitest config '${loaded.source}' sets coverage provider '${provider}', but '${coveragePackage}' is not listed in package.json.`,
              evidence: {
                configSource: loaded.source,
                provider,
                packageName: coveragePackage,
              },
            });
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isVitestConfig(fileId) || isVitestTestFile(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;

        if (source === VITEST_PACKAGE || source.startsWith("@vitest/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      if (!isVitestConfig(fileId)) return;

      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }

      // Static setupFiles references are safe to mark as used. Dynamic config
      // expressions are intentionally ignored rather than guessed.
      if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "setupFiles") {
        // falls back to the config directory when the static config could not be
        // read; otherwise the Vitest root (`test.root || root`) wins.
        const configDirectory =
          vitestRootsByConfigFile.get(normalize(fileId)) ?? path.dirname(normalize(fileId));
        const markSetupFile = (configuredPath: string) => {
          if (isModuleReference(configuredPath)) {
            adapter.markPackageAsUsed(configuredPath);
            return;
          }
          const target = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.join(configDirectory, configuredPath);
          adapter.markAsUsed(target);
        };

        if (t.isArrayExpression(node.value)) {
          for (const element of node.value.elements) {
            if (t.isStringLiteral(element)) markSetupFile(element.value);
          }
        } else if (t.isStringLiteral(node.value)) {
          markSetupFile(node.value.value);
        }
      }
    },
  },
};

export default VitestPlugin;
