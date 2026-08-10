import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized rstest configuration files
 */
const RSTEST_CONFIG_FILES = [
  "rstest.config.ts",
  "rstest.config.js",
  "rstest.config.mjs",
  "rstest.config.cjs",
  "rstest.config.json"
];

const RSTEST_PACKAGES = ["rstest", "@rstest/core", "@rstest/cli"];

/**
 * Helper to check if a file follows rstest file-naming conventions
 */
function isRstestFile(normalizedPath: string, basename: string): boolean {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(basename) ||
    normalizedPath.includes("/__tests__/") ||
    normalizedPath.startsWith("__tests__/")
  );
}

export const RstestPlugin: AnalyzerPlugin = {
  name: "rstest-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated rstest configuration files
    for (const configFile of RSTEST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check for __tests__ directory
    if (await adapter.folderExists("__tests__")) return true;

    // 3. Check package.json for rstest dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => dep === "rstest" || dep.startsWith("@rstest/"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\brstest\b/.test(s) || s.includes("rstest "))
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated configuration files
      for (const configFile of RSTEST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect __tests__ directory if present
      if (await adapter.folderExists("__tests__")) {
        adapter.markAsUsed("__tests__");
      }

      if (pkg) {
        // 3. Protect rstest and @rstest/* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === "rstest" || depName.startsWith("@rstest/")) {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 4. Mark scripts executing rstest CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\brstest\b/.test(scriptContent) || scriptContent.includes("rstest "))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (RSTEST_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("rstest");
      }

      // Protect test files (*.test.ts, *.spec.ts, __tests__/**)
      if (isRstestFile(normalized, basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("rstest");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect JS/TS config files (rstest.config.ts, etc.)
      if (RSTEST_CONFIG_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("rstest");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("rstest");
        }
      }

      // 2. Detect global test function invocations inside test files (test, it, describe, expect)
      if (isRstestFile(normalized, basename)) {
        if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
          if (["describe", "test", "it", "beforeEach", "afterEach", "beforeAll", "afterAll", "expect"].includes(node.callee.name)) {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("rstest");
          }
        }
      }

      // 3. Retain imports from rstest or @rstest/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "rstest" || source.startsWith("@rstest/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default RstestPlugin;