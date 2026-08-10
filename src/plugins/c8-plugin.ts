import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const C8_CONFIG_FILES = [
  ".c8rc",
  ".c8rc.json",
  "c8.config.js",
  "c8.config.cjs",
  "c8.config.mjs",
  "c8.config.ts"
];

const C8_PACKAGE_NAME = "c8";

export const C8Plugin: AnalyzerPlugin = {
  name: "c8-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for c8 configuration files
    for (const configFile of C8_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline c8 config, dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.c8) return true;

      const hasDep =
        (pkg.dependencies && pkg.dependencies[C8_PACKAGE_NAME]) ||
        (pkg.devDependencies && pkg.devDependencies[C8_PACKAGE_NAME]) ||
        (pkg.peerDependencies && pkg.peerDependencies[C8_PACKAGE_NAME]);

      if (hasDep) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && /\bc8\b/.test(s)
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

      // 1. Protect c8 configuration files
      for (const configFile of C8_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect c8 dependency
        const isDep =
          (pkg.dependencies && pkg.dependencies[C8_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[C8_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[C8_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(C8_PACKAGE_NAME);
        }

        // 3. Protect package.json#c8 field
        if (pkg.c8) {
          adapter.markAsUsed("package.json", "c8");
        }

        // 4. Mark scripts invoking c8 CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              /\bc8\b/.test(scriptContent)
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

      if (C8_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (basename.startsWith("c8.config.")) {
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

export default C8Plugin;