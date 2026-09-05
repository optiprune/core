import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized XO configuration and ignore files
 */
const XO_CONFIG_FILES = [
  ".xo-config",
  ".xo-config.json",
  ".xo-config.js",
  ".xo-config.cjs",
  "xo.config.js",
  "xo.config.cjs",
  ".xo-config.yaml",
  ".xo-config.yml",
  ".xoignore",
];

const XO_PACKAGE_NAME = "xo";

/**
 * Normalizes plugin names referenced in XO configuration to their package equivalents
 * (e.g. "react" -> "eslint-plugin-react", "@typescript-eslint" -> "@typescript-eslint/eslint-plugin")
 */
function normalizePluginName(name: string): string {
  if (name.startsWith("eslint-plugin-")) return name;
  if (name.startsWith("@")) {
    const [scope, plugin] = name.split("/");
    if (!plugin) return `${scope}/eslint-plugin`;
    if (plugin.startsWith("eslint-plugin-")) return name;
    return `${scope}/eslint-plugin-${plugin}`;
  }
  return `eslint-plugin-${name}`;
}

/**
 * Normalizes config extends references in XO configuration
 */
function normalizeExtendName(name: string): string {
  if (name.startsWith("eslint-config-") || name.startsWith("xo-space")) return name;
  if (name.startsWith("@")) {
    const [scope, config] = name.split("/");
    if (!config) return `${scope}/eslint-config`;
    if (config.startsWith("eslint-config-")) return name;
    return `${scope}/eslint-config-${config}`;
  }
  return `eslint-config-${name}`;
}

/**
 * Helper to process plugins, extends, and space options from XO configuration objects
 */
function processXoConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // 1. Process extends
  if (config.extends) {
    const extendsList = Array.isArray(config.extends) ? config.extends : [config.extends];
    for (const entry of extendsList) {
      if (typeof entry === "string") {
        adapter.markPackageAsUsed(normalizeExtendName(entry));
      }
    }
  }

  // 2. Process plugins
  if (config.plugins) {
    const pluginsList = Array.isArray(config.plugins) ? config.plugins : [config.plugins];
    for (const plugin of pluginsList) {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(normalizePluginName(plugin));
      }
    }
  }

  // 3. Process space option (if set to true, xo-space package is optional depending on runner, but usually internal)
  if (config.space) {
    // XO supports space option natively
  }
}

export const XoPlugin: AnalyzerPlugin = {
  name: "xo-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated XO config or ignore files
    for (const configFile of XO_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.xo) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (allDeps[XO_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bxo\b/.test(s) || /\bxo --fix\b/.test(s)),
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
      for (const configFile of XO_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect primary xo package dependency
        const isDep =
          (pkg.dependencies && pkg.dependencies[XO_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[XO_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[XO_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(XO_PACKAGE_NAME);
        }

        // 3. Process inline package.json#xo field
        if (pkg.xo) {
          adapter.markAsUsed("package.json", "xo");
          processXoConfig(pkg.xo, adapter);
        }

        // 4. Mark scripts invoking xo CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bxo\b/.test(scriptContent) || /\bxo --fix\b/.test(scriptContent))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config file if present
      const jsonConfigFile = (await adapter.folderExists(".xo-config.json"))
        ? ".xo-config.json"
        : (await adapter.folderExists(".xo-config"))
          ? ".xo-config"
          : null;

      if (jsonConfigFile) {
        const rcConfig = await adapter.readJson(jsonConfigFile);
        if (rcConfig) {
          processXoConfig(rcConfig, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (XO_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS configuration files (.xo-config.js, xo.config.js, etc.)
      if (basename.startsWith(".xo-config.") || basename.startsWith("xo.config.")) {
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

        // Inspect AST for property "extends" or "plugins"
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          if (node.key.name === "extends") {
            if (t.isStringLiteral(node.value)) {
              adapter.markPackageAsUsed(normalizeExtendName(node.value.value));
            } else if (t.isArrayExpression(node.value)) {
              for (const element of node.value.elements) {
                if (t.isStringLiteral(element)) {
                  adapter.markPackageAsUsed(normalizeExtendName(element.value));
                }
              }
            }
          }

          if (node.key.name === "plugins") {
            if (t.isStringLiteral(node.value)) {
              adapter.markPackageAsUsed(normalizePluginName(node.value.value));
            } else if (t.isArrayExpression(node.value)) {
              for (const element of node.value.elements) {
                if (t.isStringLiteral(element)) {
                  adapter.markPackageAsUsed(normalizePluginName(element.value));
                }
              }
            }
          }
        }
      }
    },
  },
};

export default XoPlugin;
