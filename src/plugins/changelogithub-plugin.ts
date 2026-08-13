import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Changelogithub configuration files
 */
const CHANGELOGITHUB_CONFIG_FILES = [
  "changelogithub.config.ts",
  "changelogithub.config.js",
  "changelogithub.config.mjs",
  "changelogithub.config.cjs",
  ".changelogithub"
];

const CHANGELOGITHUB_PACKAGE_NAME = "changelogithub";

export const ChangelogithubPlugin: AnalyzerPlugin = {
  name: "changelogithub-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Changelogithub config files
    for (const configFile of CHANGELOGITHUB_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, changelogithub dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.changelogithub) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (CHANGELOGITHUB_PACKAGE_NAME in allDeps) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bchangelogithub\b/.test(s) || s.includes("changelogithub "))
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
      for (const configFile of CHANGELOGITHUB_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect changelogithub package in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        // A declared dependency is not usage evidence by itself.

        // 3. Process inline package.json#changelogithub block
        if (pkg.changelogithub) {
          adapter.markAsUsed("package.json", "changelogithub");
        }

        // 4. Mark scripts executing changelogithub CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bchangelogithub\b/.test(scriptContent) || scriptContent.includes("changelogithub "))
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
      if (CHANGELOGITHUB_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE_NAME);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (changelogithub.config.ts, etc.)
      if (CHANGELOGITHUB_CONFIG_FILES.includes(basename)) {
        if (
          t.isExportDefaultDeclaration(node) ||
          t.isExportNamedDeclaration(node)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE_NAME);
        }
      }

      // Retain imports from changelogithub
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === CHANGELOGITHUB_PACKAGE_NAME || source.startsWith("changelogithub/")) {
          adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE_NAME);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ChangelogithubPlugin;