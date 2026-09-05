import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Lost Pixel configuration files
 */
const LOST_PIXEL_CONFIG_FILES = [
  "lostpixel.config.js",
  "lostpixel.config.ts",
  "lostpixel.config.cjs",
  "lostpixel.config.mjs",
];

const LOST_PIXEL_PACKAGE_NAME = "lost-pixel";

export const LostPixelPlugin: AnalyzerPlugin = {
  name: "lost-pixel-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated lostpixel configuration files
    for (const configFile of LOST_PIXEL_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (allDeps[LOST_PIXEL_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\blost-pixel\b/.test(s) || /\blostpixel\b/.test(s)),
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
      for (const configFile of LOST_PIXEL_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect primary lost-pixel package dependency
        const isDep =
          (pkg.dependencies && pkg.dependencies[LOST_PIXEL_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[LOST_PIXEL_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[LOST_PIXEL_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(LOST_PIXEL_PACKAGE_NAME);
        }

        // 3. Mark package.json scripts invoking lost-pixel CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\blost-pixel\b/.test(scriptContent) || /\blostpixel\b/.test(scriptContent))
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
      if (LOST_PIXEL_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (!LOST_PIXEL_CONFIG_FILES.includes(basename)) return;

      // Mark ES Module default export (export default CustomProjectConfig)
      if (t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }

      // Mark CommonJS export (module.exports = { ... })
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

      // Mark named export (export const config = { ... })
      if (t.isExportNamedDeclaration(node) && node.declaration) {
        if (t.isVariableDeclaration(node.declaration)) {
          for (const decl of node.declaration.declarations) {
            if (t.isVariableDeclarator(decl) && t.isIdentifier(decl.id)) {
              adapter.markAsUsed(fileId, decl.id.name);
            }
          }
        }
      }
    },
  },
};

export default LostPixelPlugin;
