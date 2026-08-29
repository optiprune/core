import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NYC_CONFIG_FILES = [
  ".nycrc",
  ".nycrc.json",
  ".nycrc.yaml",
  ".nycrc.yml",
  "nyc.config.js",
  "nyc.config.cjs",
  "nyc.config.mjs",
  "nyc.config.ts",
];

const NYC_PACKAGE_NAME = "nyc";

export const NycPlugin: AnalyzerPlugin = {
  name: "nyc-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for nyc configuration files
    for (const configFile of NYC_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline nyc config, dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.nyc) return true;

      const hasDep =
        (pkg.dependencies && pkg.dependencies[NYC_PACKAGE_NAME]) ||
        (pkg.devDependencies && pkg.devDependencies[NYC_PACKAGE_NAME]) ||
        (pkg.peerDependencies && pkg.peerDependencies[NYC_PACKAGE_NAME]);

      if (hasDep) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && /\bnyc\b/.test(s))) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect nyc configuration files
      for (const configFile of NYC_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect nyc dependency
        const isDep =
          (pkg.dependencies && pkg.dependencies[NYC_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[NYC_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[NYC_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(NYC_PACKAGE_NAME);
        }

        // 3. Protect package.json#nyc field
        if (pkg.nyc) {
          adapter.markAsUsed("package.json", "nyc");
        }

        // 4. Mark scripts invoking nyc CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (typeof scriptContent === "string" && /\bnyc\b/.test(scriptContent)) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (NYC_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (basename.startsWith("nyc.config.")) {
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

export default NycPlugin;
