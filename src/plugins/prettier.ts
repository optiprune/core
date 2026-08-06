import { AnalyzerPlugin } from "../types.js";

const PRETTIER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  ".prettierignore"
];

const PRETTIER_FILE_REGEX = /^(\.)?prettier(rc|\.config)/;

export const PrettierPlugin: AnalyzerPlugin = {
  name: "prettier-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies or embedded "prettier" key
    try {
      const pkg = await adapter.readJson("package.json");
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      if ("prettier" in deps || pkg?.prettier) {
        return true;
      }
    } catch {
      // package.json might not exist or be invalid JSON
    }

    // 2. Fallback: Check if any standard Prettier config file exists in workspace root
    for (const configFile of PRETTIER_CONFIG_FILES) {
      try {
        const content = await adapter.readFile(configFile);
        if (content) return true;
      } catch {
        // File doesn't exist, continue checking next
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      // Parse .prettierrc or package.json "prettier" key to extract custom plugins
      let prettierConfig: any = null;

      // Check standalone JSON configs
      for (const file of [".prettierrc", ".prettierrc.json"]) {
        try {
          prettierConfig = await adapter.readJson(file);
          if (prettierConfig) break;
        } catch {
          // Skip if missing/unparseable
        }
      }

      // Fallback: Check package.json "prettier" key
      if (!prettierConfig) {
        try {
          const pkg = await adapter.readJson("package.json");
          prettierConfig = pkg?.prettier;
        } catch {
          // ignore
        }
      }

      // Protect custom plugins listed in prettier config (e.g., plugins: ["prettier-plugin-tailwindcss"])
      if (prettierConfig && Array.isArray(prettierConfig.plugins)) {
        for (const pluginName of prettierConfig.plugins) {
          if (typeof pluginName === "string" && pluginName.startsWith(".")) {
            // Local file plugin reference -> protect file
            adapter.markAsUsed(pluginName);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      // Mark Prettier config and ignore files as implicit entry points
      const fileName = fileId.split("/").pop() || "";
      if (PRETTIER_FILE_REGEX.test(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Protect default exports in JS/MJS/CJS Prettier configs
      const fileName = fileId.split("/").pop() || "";
      if (PRETTIER_FILE_REGEX.test(fileName)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
        if (node.type === "AssignmentExpression") {
          // Support module.exports = { ... }
          if (
            node.left?.type === "MemberExpression" &&
            node.left.object?.name === "module" &&
            node.left.property?.name === "exports"
          ) {
            adapter.markAsUsed(fileId);
          }
        }
      }
    }
  }
};

export default PrettierPlugin;