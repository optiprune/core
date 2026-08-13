import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Release It! configuration files
 */
const RELEASE_IT_CONFIG_FILES = [
  ".release-it.json",
  ".release-it.js",
  ".release-it.cjs",
  ".release-it.mjs",
  ".release-it.ts",
  ".release-it.yaml",
  ".release-it.yml"
];

const RELEASE_IT_PACKAGE_NAME = "release-it";

/**
 * Normalizes plugin names referenced in configuration files to full npm package names
 */
function normalizeReleaseItPlugin(name: string): string {
  if (name.startsWith("@release-it/") || name.startsWith("release-it-")) {
    return name;
  }
  // Standard Release It! scoped plugin convention
  return `@release-it/${name}`;
}

/**
 * Helper to process Release It! configuration objects and extract plugins
 */
function processReleaseItConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process plugins object map (e.g. plugins: { "@release-it/conventional-changelog": { ... }, "bumper": { ... } })
  if (config.plugins && typeof config.plugins === "object") {
    for (const pluginKey of Object.keys(config.plugins)) {
      adapter.markPackageAsUsed(normalizeReleaseItPlugin(pluginKey));
    }
  }
}

export const ReleaseItPlugin: AnalyzerPlugin = {
  name: "release-it-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Release It! config files
    for (const configFile of RELEASE_IT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, release-it dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg["release-it"]) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === RELEASE_IT_PACKAGE_NAME ||
            dep.startsWith("@release-it/") ||
            dep.startsWith("release-it-")
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
              (/\brelease-it\b/.test(s) || s.includes("release-it "))
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
      for (const configFile of RELEASE_IT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect release-it, @release-it/*, and release-it-* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === RELEASE_IT_PACKAGE_NAME ||
            depName.startsWith("@release-it/") ||
            depName.startsWith("release-it-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Process inline package.json#release-it config block
        if (pkg["release-it"]) {
          adapter.markAsUsed("package.json", "release-it");
          processReleaseItConfig(pkg["release-it"], adapter);
        }

        // 4. Mark scripts executing release-it CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\brelease-it\b/.test(scriptContent) || scriptContent.includes("release-it "))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone .release-it.json if present
      if (await adapter.folderExists(".release-it.json")) {
        const configData = await adapter.readJson(".release-it.json");
        if (configData) {
          processReleaseItConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (RELEASE_IT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (.release-it.js, .release-it.ts, etc.)
      if (basename.startsWith(".release-it.")) {
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

        // AST Property Inspection for "plugins" object
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "plugins" &&
          t.isObjectExpression(node.value)
        ) {
          for (const prop of node.value.properties) {
            if (t.isObjectProperty(prop)) {
              let pluginKey = "";
              if (t.isIdentifier(prop.key)) {
                pluginKey = prop.key.name;
              } else if (t.isStringLiteral(prop.key)) {
                pluginKey = prop.key.value;
              }

              if (pluginKey) {
                adapter.markPackageAsUsed(normalizeReleaseItPlugin(pluginKey));
              }
            }
          }
        }
      }

      // Retain imports from release-it or @release-it/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === RELEASE_IT_PACKAGE_NAME || source.startsWith("@release-it/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ReleaseItPlugin;