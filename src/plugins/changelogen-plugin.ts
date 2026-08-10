import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Changelogen configuration files
 */
const CHANGELOGEN_CONFIG_FILES = [
  "changelogen.config.ts",
  "changelogen.config.js",
  "changelogen.config.mjs",
  "changelogen.config.cjs"
];

const CHANGELOGEN_PACKAGE_NAME = "changelogen";

export const ChangelogenPlugin: AnalyzerPlugin = {
  name: "changelogen-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Changelogen config files
    for (const configFile of CHANGELOGEN_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, changelogen dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.changelogen) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (CHANGELOGEN_PACKAGE_NAME in allDeps) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bchangelogen\b/.test(s) || s.includes("changelogen "))
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
      for (const configFile of CHANGELOGEN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect changelogen package in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        if (allDeps[CHANGELOGEN_PACKAGE_NAME]) {
          adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE_NAME);
        }

        // 3. Process inline package.json#changelogen block
        if (pkg.changelogen) {
          adapter.markAsUsed("package.json", "changelogen");
        }

        // 4. Mark scripts executing changelogen CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bchangelogen\b/.test(scriptContent) || scriptContent.includes("changelogen "))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (CHANGELOGEN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (changelogen.config.ts, etc.)
      if (CHANGELOGEN_CONFIG_FILES.includes(basename)) {
        if (
          t.isExportDefaultDeclaration(node) ||
          t.isExportNamedDeclaration(node)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE_NAME);
        }
      }

      // Retain imports from changelogen
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === CHANGELOGEN_PACKAGE_NAME || source.startsWith("changelogen/")) {
          adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE_NAME);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ChangelogenPlugin;