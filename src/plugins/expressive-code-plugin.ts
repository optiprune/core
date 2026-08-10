import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Expressive Code configuration files
 */
const EXPRESSIVE_CODE_CONFIG_FILES = [
  "ec.config.mjs",
  "ec.config.js",
  "ec.config.ts",
  "ec.config.cjs",
  "expressive-code.config.mjs",
  "expressive-code.config.js",
  "expressive-code.config.ts"
];

const EXPRESSIVE_CODE_PACKAGES = [
  "expressive-code",
  "@expressive-code/core",
  "@expressive-code/plugin-frames",
  "@expressive-code/plugin-text-markers",
  "@expressive-code/plugin-collapsible-sections",
  "@expressive-code/plugin-line-numbers",
  "astro-expressive-code",
  "remark-expressive-code"
];

/**
 * Helper to check if a package belongs to the Expressive Code ecosystem
 */
function isExpressiveCodePackage(source: string): boolean {
  return (
    source === "expressive-code" ||
    source.startsWith("@expressive-code/") ||
    source === "astro-expressive-code" ||
    source === "remark-expressive-code"
  );
}

/**
 * Helper to process Expressive Code config objects and extract plugins/themes
 */
function processExpressiveCodeConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process plugins array
  if (Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      if (typeof plugin === "string" && !plugin.startsWith(".") && !plugin.startsWith("/")) {
        adapter.markPackageAsUsed(plugin);
      }
    }
  }

  // Process themes array or string
  if (config.themes) {
    const themesList = Array.isArray(config.themes) ? config.themes : [config.themes];
    for (const theme of themesList) {
      if (typeof theme === "string" && !theme.startsWith(".") && !theme.startsWith("/")) {
        adapter.markPackageAsUsed(theme);
      }
    }
  }
}

export const ExpressiveCodePlugin: AnalyzerPlugin = {
  name: "expressive-code-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Expressive Code config files
    for (const configFile of EXPRESSIVE_CODE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for Expressive Code dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => isExpressiveCodePackage(dep))) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated Expressive Code config files
      for (const configFile of EXPRESSIVE_CODE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all @expressive-code/*, expressive-code, astro-expressive-code, and remark-expressive-code packages
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (isExpressiveCodePackage(depName)) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (EXPRESSIVE_CODE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect JS/TS config files (ec.config.mjs, expressive-code.config.ts, etc.)
      if (
        basename.startsWith("ec.config.") ||
        basename.startsWith("expressive-code.config.")
      ) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
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
        }
      }

      // 2. Detect astroExpressiveCode({ ... }) calls inside astro.config.* or remarkExpressiveCode({ ... })
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const calleeName = node.callee.name;

        if (calleeName === "astroExpressiveCode") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("astro-expressive-code");
        } else if (calleeName === "remarkExpressiveCode") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("remark-expressive-code");
        }
      }

      // 3. Retain imports from expressive-code or @expressive-code/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (isExpressiveCodePackage(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ExpressiveCodePlugin;