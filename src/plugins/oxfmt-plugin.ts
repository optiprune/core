import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const OXFMT_CONFIG_FILES = [
  ".oxfmtrc",
  ".oxfmtrc.json",
  ".oxfmtrc.jsonc",
  "oxfmt.json",
  "oxfmt.jsonc",
  ".oxfmtignore",
];

const OXFMT_PACKAGE_NAME = "oxfmt";

export const OxfmtPlugin: AnalyzerPlugin = {
  name: "oxfmt-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated oxfmt config files or ignore files
    for (const configFile of OXFMT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for "oxfmt" dependency, config block, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.oxfmt) return true;

      const hasDep =
        (pkg.dependencies && pkg.dependencies[OXFMT_PACKAGE_NAME]) ||
        (pkg.devDependencies && pkg.devDependencies[OXFMT_PACKAGE_NAME]) ||
        (pkg.peerDependencies && pkg.peerDependencies[OXFMT_PACKAGE_NAME]);

      if (hasDep) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("oxfmt") || s.includes("npx oxfmt") || s.includes("bunx oxfmt")),
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

      // 1. Protect all dedicated oxfmt configuration & ignore files
      for (const configFile of OXFMT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 2. Protect oxfmt package dependency if present
      if (pkg) {
        if (
          (pkg.dependencies && pkg.dependencies[OXFMT_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[OXFMT_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[OXFMT_PACKAGE_NAME])
        ) {
          adapter.markPackageAsUsed(OXFMT_PACKAGE_NAME);
        }

        // 3. Mark oxfmt config block in package.json as used
        if (pkg.oxfmt) {
          adapter.markAsUsed("package.json", "oxfmt");
        }

        // 4. Mark scripts invoking oxfmt as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (scriptContent.includes("oxfmt") ||
                scriptContent.includes("npx oxfmt") ||
                scriptContent.includes("bunx oxfmt"))
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

      // Keep configuration files active
      if (OXFMT_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Handle programmatically exported JavaScript/TypeScript oxfmt configuration files if used (e.g. oxfmt.config.ts / .js)
      if (basename.startsWith("oxfmt.config.")) {
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
    },
  },
};

export default OxfmtPlugin;
