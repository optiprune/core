import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Size Limit configuration files
 */
const SIZE_LIMIT_CONFIG_FILES = [
  ".size-limit.json",
  "size-limit.json",
  ".size-limit.js",
  "size-limit.js",
  "size-limit.ts",
  "size-limit.mjs",
  "size-limit.cjs",
  "size-limit.config.js",
];

const SIZE_LIMIT_PACKAGE_NAME = "size-limit";

/**
 * Helper to process Size Limit configuration arrays or objects and extract path/file targets
 */
function processSizeLimitConfig(config: any, adapter: any): void {
  if (!config) return;

  const entries = Array.isArray(config) ? config : [config];
  for (const entry of entries) {
    if (entry && typeof entry === "object") {
      // Process path / file / entry AST targets (e.g. "path": "dist/index.js")
      const pathTarget = entry.path || entry.file;
      if (typeof pathTarget === "string") {
        adapter.markAsUsed(pathTarget);
      } else if (Array.isArray(pathTarget)) {
        for (const p of pathTarget) {
          if (typeof p === "string") {
            adapter.markAsUsed(p);
          }
        }
      }
    }
  }
}

export const SizeLimitPlugin: AnalyzerPlugin = {
  name: "size-limit-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Size Limit configuration files
    for (const configFile of SIZE_LIMIT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, size-limit dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg["size-limit"]) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === SIZE_LIMIT_PACKAGE_NAME ||
            dep.startsWith("@size-limit/") ||
            dep.startsWith("size-limit-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bsize-limit\b/.test(s) || s.includes("size-limit")),
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
      for (const configFile of SIZE_LIMIT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect size-limit and all @size-limit/* preset packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === SIZE_LIMIT_PACKAGE_NAME ||
            depName.startsWith("@size-limit/") ||
            depName.startsWith("size-limit-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Process inline package.json#size-limit configuration array/block
        if (pkg["size-limit"]) {
          adapter.markAsUsed("package.json", "size-limit");
          processSizeLimitConfig(pkg["size-limit"], adapter);
        }

        // 4. Mark scripts executing size-limit CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bsize-limit\b/.test(scriptContent) || scriptContent.includes("size-limit"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config files if present
      const jsonConfigFile = (await adapter.folderExists(".size-limit.json"))
        ? ".size-limit.json"
        : (await adapter.folderExists("size-limit.json"))
          ? "size-limit.json"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processSizeLimitConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (SIZE_LIMIT_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed(SIZE_LIMIT_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (size-limit.js, .size-limit.js, etc.)
      if (SIZE_LIMIT_CONFIG_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed(SIZE_LIMIT_PACKAGE_NAME);
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
          adapter.markPackageAsUsed(SIZE_LIMIT_PACKAGE_NAME);
        }

        // AST Property Inspection for "path" or "file" properties in exported configuration arrays
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          (node.key.name === "path" || node.key.name === "file")
        ) {
          if (t.isStringLiteral(node.value)) {
            adapter.markAsUsed(node.value.value);
          } else if (t.isArrayExpression(node.value)) {
            for (const el of node.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markAsUsed(el.value);
              }
            }
          }
        }
      }

      // Retain imports from size-limit or @size-limit/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === SIZE_LIMIT_PACKAGE_NAME || source.startsWith("@size-limit/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default SizeLimitPlugin;
