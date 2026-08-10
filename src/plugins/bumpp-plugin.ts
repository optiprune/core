import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Bumpp configuration files
 */
const BUMPP_CONFIG_FILES = [
  "bumpp.config.ts",
  "bumpp.config.js",
  "bumpp.config.mjs",
  "bumpp.config.cjs"
];

const BUMPP_PACKAGE_NAME = "bumpp";

export const BumppPlugin: AnalyzerPlugin = {
  name: "bumpp-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Bumpp configuration files
    for (const configFile of BUMPP_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, bumpp dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.bumpp) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (BUMPP_PACKAGE_NAME in allDeps) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bbumpp\b/.test(s) || s.includes("bumpp "))
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
      for (const configFile of BUMPP_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect bumpp package in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        if (allDeps[BUMPP_PACKAGE_NAME]) {
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
        }

        // 3. Process inline package.json#bumpp block
        if (pkg.bumpp) {
          adapter.markAsUsed("package.json", "bumpp");
        }

        // 4. Mark scripts executing bumpp CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bbumpp\b/.test(scriptContent) || scriptContent.includes("bumpp "))
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
      if (BUMPP_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (bumpp.config.ts, etc.)
      if (BUMPP_CONFIG_FILES.includes(basename)) {
        if (
          t.isExportDefaultDeclaration(node) ||
          t.isExportNamedDeclaration(node)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
        }
      }

      // Retain imports from bumpp
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === BUMPP_PACKAGE_NAME || source.startsWith("bumpp/")) {
          adapter.markPackageAsUsed(BUMPP_PACKAGE_NAME);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default BumppPlugin;