import { AnalyzerPlugin } from "../types.js";

/**
 * Prettier Plugin
 * Handles Prettier-specific patterns: .prettierrc, prettier.config.js, and dependencies.
 */
export const PrettierPlugin: AnalyzerPlugin = {
  name: "prettier-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["prettier"] || pkg.devDependencies?.["prettier"]);
      if (hasDep) return true;
    }
    const configFiles = [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.js",
      ".prettierrc.cjs",
      "prettier.config.js",
      "prettier.config.cjs"
    ];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const configFiles = [
        ".prettierrc",
        ".prettierrc.json",
        ".prettierrc.yml",
        ".prettierrc.yaml",
        ".prettierrc.js",
        ".prettierrc.cjs",
        "prettier.config.js",
        "prettier.config.cjs",
        ".prettierignore"
      ];
      if (configFiles.some(f => fileId.endsWith(f))) {
        adapter.markAsUsed(fileId);
        adapter.markAsUsed("prettier");
      }
    }
  }
};

export default PrettierPlugin;
