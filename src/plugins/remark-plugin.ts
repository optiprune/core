import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Remark configuration files
 */
const REMARK_CONFIG_FILES = [
  ".remarkrc",
  ".remarkrc.json",
  ".remarkrc.yaml",
  ".remarkrc.yml",
  ".remarkrc.js",
  ".remarkrc.mjs",
  ".remarkrc.cjs",
  "remark.config.js",
  "remark.config.mjs",
  "remark.config.cjs",
];

const REMARK_CORE_PACKAGES = [
  "remark",
  "remark-cli",
  "remark-parse",
  "remark-stringify",
  "remark-rehype",
];

/**
 * Normalizes plugin names referenced in Remark configuration objects to npm package names
 */
function normalizeRemarkPlugin(pluginName: string): string {
  if (pluginName.startsWith("remark-") || pluginName.startsWith("@")) {
    return pluginName;
  }
  return `remark-${pluginName}`;
}

/**
 * Helper to process Remark configuration objects (plugins array or plugins object)
 */
function processRemarkConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  const plugins = config.plugins;

  // Case 1: Array of plugins: plugins: ['gfm', 'remark-math', ['remark-toc', { maxDepth: 3 }]]
  if (Array.isArray(plugins)) {
    for (const plugin of plugins) {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(normalizeRemarkPlugin(plugin));
      } else if (Array.isArray(plugin) && typeof plugin[0] === "string") {
        adapter.markPackageAsUsed(normalizeRemarkPlugin(plugin[0]));
      }
    }
  }
  // Case 2: Object map of plugins: plugins: { 'remark-gfm': {}, toc: { maxDepth: 2 } }
  else if (plugins && typeof plugins === "object") {
    for (const pluginKey of Object.keys(plugins)) {
      adapter.markPackageAsUsed(normalizeRemarkPlugin(pluginKey));
    }
  }
}

export const RemarkPlugin: AnalyzerPlugin = {
  name: "remark-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Remark config files
    for (const configFile of REMARK_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependencies, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.remarkConfig || pkg.remark) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => dep === "remark" || dep.startsWith("remark-"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bremark\b/.test(s) || s.includes("remark .")),
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

      // 1. Protect dedicated Remark configuration files
      for (const configFile of REMARK_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect remark and all remark-* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === "remark" || depName.startsWith("remark-")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Process inline package.json#remarkConfig or package.json#remark blocks
        const inlineConfig = pkg.remarkConfig || pkg.remark;
        if (inlineConfig) {
          adapter.markAsUsed("package.json", pkg.remarkConfig ? "remarkConfig" : "remark");
          processRemarkConfig(inlineConfig, adapter);
        }

        // 4. Mark scripts executing remark CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bremark\b/.test(scriptContent) || scriptContent.includes("remark ."))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config files if present
      const jsonConfigFile = (await adapter.folderExists(".remarkrc.json"))
        ? ".remarkrc.json"
        : (await adapter.folderExists(".remarkrc"))
          ? ".remarkrc"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processRemarkConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (REMARK_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect JS/TS config files (.remarkrc.js, remark.config.js, etc.)
      if (basename.startsWith(".remarkrc.") || basename.startsWith("remark.config.")) {
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

        // AST Property Inspection for "plugins"
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "plugins") {
          if (t.isArrayExpression(node.value)) {
            for (const el of node.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(normalizeRemarkPlugin(el.value));
              } else if (
                t.isArrayExpression(el) &&
                el.elements[0] &&
                t.isStringLiteral(el.elements[0])
              ) {
                adapter.markPackageAsUsed(normalizeRemarkPlugin(el.elements[0].value));
              }
            }
          }
        }
      }

      // 2. Retain imports from remark or remark-*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "remark" || source.startsWith("remark-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default RemarkPlugin;
