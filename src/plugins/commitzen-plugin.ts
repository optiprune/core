import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Commitizen configuration files
 */
const COMMITIZEN_CONFIG_FILES = [
  ".czrc",
  ".cz.json",
  ".cz.yaml",
  ".cz.yml",
  "cz.config.js",
  "cz.config.cjs",
  "cz.config.mjs",
  "cz.config.ts",
];

const COMMITIZEN_CORE_PACKAGES = ["commitizen", "cz-cli"];

/**
 * Normalizes adapter names declared in .czrc or package.json#config.commitizen
 */
function normalizeCzAdapter(pathOrPkg: string, adapter: any): void {
  if (!pathOrPkg || typeof pathOrPkg !== "string") return;

  // Handles cases where path specifies npm package name (e.g. "path": "cz-conventional-changelog" or "path": "./node_modules/cz-git")
  if (!pathOrPkg.startsWith(".") || pathOrPkg.includes("node_modules")) {
    let pkgName = pathOrPkg;
    if (pkgName.includes("node_modules/")) {
      pkgName = pkgName.split("node_modules/").pop() || pkgName;
    }
    adapter.markPackageAsUsed(pkgName);
  }
}

/**
 * Helper to process Commitizen configuration objects
 */
function processCommitizenConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  if (config.path) {
    normalizeCzAdapter(config.path, adapter);
  }
}

export const CommitizenPlugin: AnalyzerPlugin = {
  name: "commitizen-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Commitizen config files
    for (const configFile of COMMITIZEN_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependencies, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.config?.commitizen) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            COMMITIZEN_CORE_PACKAGES.includes(dep) || dep.startsWith("cz-") || dep.includes("/cz-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bcz\b/.test(s) || /\bgit-cz\b/.test(s) || s.includes("commitizen")),
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

      // 1. Protect dedicated Commitizen configuration files
      for (const configFile of COMMITIZEN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect commitizen core and all cz-* adapter packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            COMMITIZEN_CORE_PACKAGES.includes(depName) ||
            depName.startsWith("cz-") ||
            depName.includes("/cz-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Process inline package.json#config.commitizen block
        if (pkg.config?.commitizen) {
          adapter.markAsUsed("package.json", "config.commitizen");
          processCommitizenConfig(pkg.config.commitizen, adapter);
        }

        // 4. Mark scripts executing cz, git-cz, or commitizen CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bcz\b/.test(scriptContent) ||
                /\bgit-cz\b/.test(scriptContent) ||
                scriptContent.includes("commitizen"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone .czrc or .cz.json config files if present
      const jsonConfigFile = (await adapter.folderExists(".cz.json"))
        ? ".cz.json"
        : (await adapter.folderExists(".czrc"))
          ? ".czrc"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processCommitizenConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (COMMITIZEN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (cz.config.js, cz.config.ts, etc.)
      if (basename.startsWith("cz.config.")) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
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

        // AST Property Inspection for "path" property (e.g. path: 'cz-conventional-changelog')
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "path" &&
          t.isStringLiteral(node.value)
        ) {
          normalizeCzAdapter(node.value.value, adapter);
        }
      }

      // Retain imports from commitizen or cz-* adapter packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "commitizen" || source.startsWith("cz-") || source.includes("/cz-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default CommitizenPlugin;
