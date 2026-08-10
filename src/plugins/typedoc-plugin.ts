import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized TypeDoc configuration files
 */
const TYPEDOC_CONFIG_FILES = [
  "typedoc.json",
  "typedoc.jsonc",
  "typedoc.config.js",
  "typedoc.config.cjs",
  "typedoc.config.mjs",
  "typedoc.js",
  "typedoc.cjs",
  "typedoc.mjs",
  ".typedocrc",
  ".typedocrc.json"
];

const TYPEDOC_PACKAGE_NAME = "typedoc";

/**
 * Normalizes and protects plugins declared inside TypeDoc configuration
 */
function processTypeDocPlugins(pluginValues: unknown, adapter: any): void {
  if (typeof pluginValues === "string") {
    adapter.markPackageAsUsed(pluginValues);
  } else if (Array.isArray(pluginValues)) {
    for (const pluginName of pluginValues) {
      if (typeof pluginName === "string") {
        adapter.markPackageAsUsed(pluginName);
      }
    }
  }
}

/**
 * Helper to process TypeDoc configuration objects
 */
function processTypeDocConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process "plugin" or "plugins" field
  if (config.plugin) {
    processTypeDocPlugins(config.plugin, adapter);
  }
  if (config.plugins) {
    processTypeDocPlugins(config.plugins, adapter);
  }

  // Process "entryPoints" if specified as files or globs
  if (config.entryPoints) {
    const entryPoints = Array.isArray(config.entryPoints)
      ? config.entryPoints
      : [config.entryPoints];

    for (const entry of entryPoints) {
      if (typeof entry === "string" && !entry.includes("*")) {
        adapter.markAsUsed(entry);
      }
    }
  }
}

export const TypeDocPlugin: AnalyzerPlugin = {
  name: "typedoc-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated TypeDoc config files
    for (const configFile of TYPEDOC_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.typedoc) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (allDeps[TYPEDOC_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && /\btypedoc\b/.test(s)
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

      // 1. Mark dedicated configuration files as used
      for (const configFile of TYPEDOC_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect typedoc package and typedoc plugins in package.json dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === TYPEDOC_PACKAGE_NAME ||
            depName.startsWith("typedoc-plugin-") ||
            depName.includes("/typedoc-plugin-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 3. Process inline package.json#typedoc field
        if (pkg.typedoc) {
          adapter.markAsUsed("package.json", "typedoc");
          processTypeDocConfig(pkg.typedoc, adapter);
        }

        // 4. Mark scripts executing typedoc CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              /\btypedoc\b/.test(scriptContent)
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config files if present
      const jsonConfigFile =
        (await adapter.folderExists("typedoc.json"))
          ? "typedoc.json"
          : (await adapter.folderExists("typedoc.jsonc"))
          ? "typedoc.jsonc"
          : (await adapter.folderExists(".typedocrc.json"))
          ? ".typedocrc.json"
          : (await adapter.folderExists(".typedocrc"))
          ? ".typedocrc"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processTypeDocConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (TYPEDOC_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS configuration files (typedoc.config.js, typedoc.js, etc.)
      if (
        basename.startsWith("typedoc.config.") ||
        basename === "typedoc.js" ||
        basename === "typedoc.cjs" ||
        basename === "typedoc.mjs"
      ) {
        // Mark ES module default exports
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Mark CommonJS module.exports assignments
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

        // Inspect AST for "plugin" or "plugins" property arrays
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          if (node.key.name === "plugin" || node.key.name === "plugins") {
            if (t.isStringLiteral(node.value)) {
              adapter.markPackageAsUsed(node.value.value);
            } else if (t.isArrayExpression(node.value)) {
              for (const element of node.value.elements) {
                if (t.isStringLiteral(element)) {
                  adapter.markPackageAsUsed(element.value);
                }
              }
            }
          }
        }
      }
    }
  }
};

export default TypeDocPlugin;