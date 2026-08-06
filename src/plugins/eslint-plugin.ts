import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

/**
 * ESLint Plugin
 * Handles ESLint-specific patterns: configs, plugins, presets, and custom rules.
 */
export const EslintPlugin: AnalyzerPlugin = {
  name: "eslint-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["eslint"] || pkg.devDependencies?.["eslint"]);
      if (hasDep) return true;
    }
    const configFiles = [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.yaml",
      ".eslintrc.yml",
      ".eslintrc.json",
      ".eslintrc"
    ];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const configFiles = [
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        ".eslintrc.js",
        ".eslintrc.cjs",
        ".eslintrc.yaml",
        ".eslintrc.yml",
        ".eslintrc.json",
        ".eslintrc",
        ".eslintignore"
      ];
      if (configFiles.some(f => fileId.endsWith(f))) {
        adapter.markAsUsed(fileId);
        adapter.markAsUsed("eslint");
      }
      // Mark custom rules as used
      if (fileId.includes("rules/") && (fileId.endsWith(".js") || fileId.endsWith(".ts"))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Analyze ESLint config files for plugins and extends
      if (fileId.includes("eslint.config.") || fileId.includes(".eslintrc")) {
        if (t.isStringLiteral(node)) {
          const val = node.value;
          // Detect ESLint plugins (e.g., "eslint-plugin-react")
          if (val.includes("eslint-plugin-")) {
            const pluginName = val.startsWith("plugin:") ? val.split(":")[1] : val;
            if (pluginName) {
              adapter.markAsUsed(pluginName);
            }
            adapter.markAsUsed("eslint");
          }
          // Detect ESLint configs/presets (e.g., "eslint-config-airbnb")
          if (val.includes("eslint-config-")) {
            adapter.markAsUsed(val);
            adapter.markAsUsed("eslint");
          }
        }

        // Handle 'plugins' and 'extends' arrays/objects
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          if (["plugins", "extends"].includes(node.key.name)) {
            adapter.markAsUsed("eslint");
          }
        }
      }
    }
  }
};

export default EslintPlugin;
