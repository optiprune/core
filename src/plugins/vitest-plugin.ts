import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VITEST_CONFIG_FILES = [
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
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs"
];

const VITEST_PACKAGES = [
  "vitest",
  "@vitest/coverage-v8",
  "@vitest/coverage-istanbul",
  "@vitest/ui",
  "@vitest/browser",
  "jsdom",
  "happy-dom"
];

export const VitestPlugin: AnalyzerPlugin = {
  name: "vitest-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (VITEST_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("vitest") || s === "vitest")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of VITEST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("__tests__");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasVitestDep = VITEST_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of VITEST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 1. Protect installed Vitest ecosystem packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // 2. Track npm scripts invoking Vitest (e.g., "test": "vitest run")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("vitest") || scriptContent === "vitest")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("vitest");
          }
        }
      }

      // 3. Emit finding if Vitest configs exist but vitest is not listed
      if (hasConfigFile && !hasVitestDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Vitest configuration found, but 'vitest' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Protect configuration and workspace files
      if (VITEST_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vitest");
      }

      // 2. Protect test files and benchmarks
      if (
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/__tests__/") ||
        normalized.includes(".bench.")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vitest");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = VITEST_CONFIG_FILES.includes(basename);
      const isTestFile =
        normalized.includes(".test.") ||
        normalized.includes(".spec.") ||
        normalized.includes("/__tests__/");

      // 1. Detect ESM imports for vitest in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "vitest" || source.startsWith("@vitest/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Vitest configuration files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("vitest");
        }

        // Detect defineConfig({ test: { environment: 'jsdom' | 'happy-dom', setupFiles: [...] } })
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          const keyName = node.key.name;

          // Detect test environment (e.g., environment: 'jsdom')
          if (keyName === "environment" && t.isStringLiteral(node.value)) {
            const env = node.value.value;
            if (env === "jsdom" || env === "happy-dom") {
              adapter.markPackageAsUsed(env);
            }
          }

          // Detect setupFiles: ['./vitest.setup.ts']
          if (keyName === "setupFiles") {
            if (t.isArrayExpression(node.value)) {
              node.value.elements.forEach((el: any) => {
                if (t.isStringLiteral(el)) {
                  adapter.markAsUsed(el.value);
                }
              });
            } else if (t.isStringLiteral(node.value)) {
              adapter.markAsUsed(node.value.value);
            }
          }

          // Detect coverage provider (e.g., provider: 'v8' | 'istanbul')
          if (keyName === "provider" && t.isStringLiteral(node.value)) {
            const provider = node.value.value;
            if (provider === "v8") adapter.markPackageAsUsed("@vitest/coverage-v8");
            if (provider === "istanbul") adapter.markPackageAsUsed("@vitest/coverage-istanbul");
          }
        }
      }

      // 3. In Test files: Protect Vitest globals (describe, it, test, expect, vi, beforeEach, etc.)
      if (isTestFile) {
        if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
          const vitestGlobals = new Set([
            "describe",
            "it",
            "test",
            "expect",
            "beforeEach",
            "afterEach",
            "beforeAll",
            "afterAll",
            "vi"
          ]);

          if (vitestGlobals.has(node.callee.name)) {
            adapter.markPackageAsUsed("vitest");
          }
        }
      }
    }
  }
};

export default VitestPlugin;