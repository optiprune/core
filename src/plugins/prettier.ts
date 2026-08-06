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

  /**
   * Erkennt Prettier anhand der package.json oder vorhandener Konfigurationsdateien.
   */
  detect: async (adapter) => {
    // 1. Prüfung der package.json (Dependencies oder "prettier"-Key)
    try {
      const pkg = await adapter.readJson("package.json");
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      if ("prettier" in deps || pkg?.prettier) {
        return true;
      }
    } catch {
      // package.json fehlt oder ist ungültig
    }

    // 2. Fallback: Prüfung auf Standard-Konfigurationsdateien im Root
    for (const configFile of PRETTIER_CONFIG_FILES) {
      try {
        const content = await adapter.readFile(configFile);
        if (content) return true;
      } catch {
        // Datei existiert nicht
      }
    }
    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      let prettierConfig: any = null;
      
      // Versuche Konfiguration aus JSON-Dateien zu lesen
      for (const file of [".prettierrc", ".prettierrc.json"]) {
        try {
          prettierConfig = await adapter.readJson(file);
          if (prettierConfig) break;
        } catch {
          // Überspringen bei Fehlern
        }
      }

      // Fallback auf package.json "prettier" Key
      if (!prettierConfig) {
        try {
          const pkg = await adapter.readJson("package.json");
          prettierConfig = pkg?.prettier;
        } catch {
          // ignorieren
        }
      }

      // Schütze lokale Plugins, die in der Prettier-Config gelistet sind
      if (prettierConfig && Array.isArray(prettierConfig.plugins)) {
        for (const pluginName of prettierConfig.plugins) {
          if (typeof pluginName === "string" && pluginName.startsWith(".")) {
            // Lokale Dateireferenz -> Datei schützen
            adapter.markAsUsed(pluginName);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      // Markiert Prettier-Config und .prettierignore als Einstiegspunkte
      const fileName = fileId.split("/").pop() || "";
      if (PRETTIER_FILE_REGEX.test(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Schützt Exporte in JS/MJS/CJS Prettier-Konfigurationen
      const fileName = fileId.split("/").pop() || "";
      if (PRETTIER_FILE_REGEX.test(fileName)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
        if (node.type === "AssignmentExpression") {
          // Unterstützung für module.exports = { ... }
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
