import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

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
  version: "1.1.0",

  /**
   * Erkennt Prettier anhand der package.json oder vorhandener Konfigurationsdateien.
   */
  detect: async (adapter) => {
    // 1. Prüfung der package.json (Dependencies oder "prettier"-Key)
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ("prettier" in deps || pkg.prettier) {
        return true;
      }
    }

    // 2. Prüfung auf Standard-Konfigurationsdateien im Root
    for (const configFile of PRETTIER_CONFIG_FILES) {
      const content = await adapter.readFile(configFile);
      if (content !== null) return true;
    }
    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasPrettierDep = pkg ? !!(pkg.dependencies?.["prettier"] || pkg.devDependencies?.["prettier"]) : false;
      
      let hasConfigFile = false;
      let prettierConfig: any = null;

      // Prüfe auf Konfigurationsdateien
      for (const file of PRETTIER_CONFIG_FILES) {
        const content = await adapter.readFile(file);
        if (content !== null) {
          hasConfigFile = true;
          // Versuche JSON-Konfigurationen zu parsen
          if (file.endsWith(".json") || file === ".prettierrc") {
            try {
              prettierConfig = JSON.parse(content);
            } catch {
              // Ignorieren bei Parse-Fehlern
            }
          }
          if (prettierConfig) break;
        }
      }

      // Fallback auf package.json "prettier" Key
      if (!prettierConfig && pkg?.prettier) {
        prettierConfig = pkg.prettier;
        hasConfigFile = true; // package.json selbst fungiert als Config
      }

      // Check for missing dependency
      if (hasConfigFile && !hasPrettierDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Prettier configuration found but 'prettier' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }

      // Schütze lokale Plugins, die in der Prettier-Config gelistet sind
      if (prettierConfig && Array.isArray(prettierConfig.plugins)) {
        for (const pluginName of prettierConfig.plugins) {
          if (typeof pluginName === "string" && (pluginName.startsWith(".") || pluginName.startsWith("/"))) {
            // Lokale Dateireferenz -> Datei schützen
            adapter.markAsUsed(pluginName);
          } else if (typeof pluginName === "string") {
            // Externes Plugin -> als verwendet markieren (für Dependency-Check)
            adapter.markAsUsed(pluginName);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      // Markiert Prettier-Config und .prettierignore als Einstiegspunkte
      const fileName = path.basename(fileId);
      if (PRETTIER_FILE_REGEX.test(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Schützt Exporte in JS/MJS/CJS Prettier-Konfigurationen
      const fileName = path.basename(fileId);
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

        // Suche nach Plugins in JS-Konfigurationen
        if (node.type === "Property" || node.type === "ObjectProperty") {
          const keyName = (node.key as any).name || (node.key as any).value;
          if (keyName === "plugins" && node.value.type === "ArrayExpression") {
            node.value.elements.forEach((el: any) => {
              if (el.type === "Literal" && typeof el.value === "string") {
                adapter.markAsUsed(el.value);
              }
            });
          }
        }
      }
    }
  }
};

export default PrettierPlugin;
