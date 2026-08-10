import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CYPRESS_CONFIG_FILES = [
  "cypress.config.js",
  "cypress.config.ts",
  "cypress.config.cjs",
  "cypress.config.mjs",
  "cypress.json"
];

const CYPRESS_PACKAGE_NAME = "cypress";

export const CypressPlugin: AnalyzerPlugin = {
  name: "cypress-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    for (const configFile of CYPRESS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if (await adapter.folderExists("cypress")) return true;

    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies
    };

    return CYPRESS_PACKAGE_NAME in allDeps;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // Protect Cypress configs and default support directory
      for (const configFile of CYPRESS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists("cypress")) {
        adapter.markAsUsed("cypress");
      }

      if (pkg) {
        if (
          pkg.dependencies?.[CYPRESS_PACKAGE_NAME] ||
          pkg.devDependencies?.[CYPRESS_PACKAGE_NAME] ||
          pkg.peerDependencies?.[CYPRESS_PACKAGE_NAME]
        ) {
          adapter.markPackageAsUsed(CYPRESS_PACKAGE_NAME);
        }

        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              /\bcypress\b/.test(scriptContent)
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

      if (CYPRESS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Mark Cypress spec, command, fixture, and component files
      if (
        normalized.includes("cypress/") ||
        /\.(cy|spec)\.[jt]sx?$/.test(normalized)
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (CYPRESS_CONFIG_FILES.includes(basename)) {
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
      }
    }
  }
};

export default CypressPlugin;