import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const LINTHTML_CONFIG_FILES = [
  ".linthtmlrc",
  ".linthtmlrc.json",
  ".linthtmlrc.yaml",
  ".linthtmlrc.yml",
  "linthtml.config.js",
  "linthtml.config.cjs",
  "linthtml.config.mjs",
  "linthtml.config.ts",
  ".linthtmlignore"
];

const LINTHTML_PACKAGE_NAME = "@linthtml/linthtml";
const LINTHTML_ALT_PACKAGE_NAME = "linthtml";

export const LintHtmlPlugin: AnalyzerPlugin = {
  name: "linthtml-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated LintHTML config files or ignore files
    for (const configFile of LINTHTML_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for "linthtml" dependency, config block, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.linthtml) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (allDeps[LINTHTML_PACKAGE_NAME] || allDeps[LINTHTML_ALT_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && /\blinthtml\b/.test(s)
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

      // 1. Protect dedicated LintHTML configuration & ignore files
      for (const configFile of LINTHTML_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect LintHTML package dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        // A declared dependency is not usage evidence by itself.
        // A declared dependency is not usage evidence by itself.

        // 3. Mark inline linthtml field in package.json as used
        if (pkg.linthtml) {
          adapter.markAsUsed("package.json", "linthtml");
        }

        // 4. Mark scripts invoking linthtml CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              /\blinthtml\b/.test(scriptContent)
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

      if (LINTHTML_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Handle JS/TS configuration files (e.g. linthtml.config.js, linthtml.config.ts)
      if (basename.startsWith("linthtml.config.")) {
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

export default LintHtmlPlugin;