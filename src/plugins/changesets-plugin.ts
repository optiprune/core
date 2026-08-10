import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Changesets configuration files
 */
const CHANGESET_CONFIG_FILE = ".changeset/config.json";

const CHANGESETS_CLI_PACKAGE = "@changesets/cli";

/**
 * Helper to process Changesets config.json properties and extract changelog generators or plugins
 */
function processChangesetsConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process changelog generator module (e.g. "changelog": "@changesets/changelog-github" or ["@changesets/changelog-github", { "repo": "..." }])
  if (config.changelog) {
    let changelogPkg: string | null = null;

    if (typeof config.changelog === "string") {
      changelogPkg = config.changelog;
    } else if (Array.isArray(config.changelog) && typeof config.changelog[0] === "string") {
      changelogPkg = config.changelog[0];
    }

    if (changelogPkg && !changelogPkg.startsWith(".") && !changelogPkg.startsWith("/")) {
      adapter.markPackageAsUsed(changelogPkg);
    }
  }

  // Process ignore packages array (e.g. "ignore": ["@scope/internal-pkg"])
  if (Array.isArray(config.ignore)) {
    for (const ignoredPkg of config.ignore) {
      if (typeof ignoredPkg === "string") {
        adapter.markPackageAsUsed(ignoredPkg);
      }
    }
  }
}

export const ChangesetsPlugin: AnalyzerPlugin = {
  name: "changesets-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for .changeset directory or config file
    if (await adapter.folderExists(".changeset")) return true;

    // 2. Check package.json for @changesets/* dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => dep.startsWith("@changesets/"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bchangeset\b/.test(s) || s.includes("changeset status"))
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

      // 1. Protect .changeset directory and README/config files
      if (await adapter.folderExists(".changeset")) {
        adapter.markAsUsed(".changeset");
      }

      if (await adapter.folderExists(CHANGESET_CONFIG_FILE)) {
        adapter.markAsUsed(CHANGESET_CONFIG_FILE);
      }

      if (pkg) {
        // 2. Protect all @changesets/* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@changesets/")) {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 3. Mark scripts executing changeset CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bchangeset\b/.test(scriptContent) || scriptContent.includes("changeset status"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 4. Parse .changeset/config.json if present
      if (await adapter.folderExists(CHANGESET_CONFIG_FILE)) {
        const configData = await adapter.readJson(CHANGESET_CONFIG_FILE);
        if (configData) {
          processChangesetsConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect all files in .changeset directory (.changeset/config.json, .changeset/README.md, .changeset/*.md)
      if (normalized.includes("/.changeset/") || normalized.startsWith(".changeset/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed(CHANGESETS_CLI_PACKAGE);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      // Retain imports from @changesets/* in JavaScript / TypeScript files
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@changesets/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default ChangesetsPlugin;