import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Ladle configuration and customization files
 */
const LADLE_CONFIG_FILES = [
  ".ladle/config.mjs",
  ".ladle/config.js",
  ".ladle/config.ts",
  ".ladle/components.tsx",
  ".ladle/components.jsx",
  ".ladle/components.js",
  ".ladle/head.html",
];

const LADLE_PACKAGE_NAME = "@ladle/react";

/**
 * Helper to process Ladle config objects and protect story/global imports
 */
function processLadleConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Protect global CSS or setup scripts specified in config
  if (config.import && Array.isArray(config.import)) {
    for (const imp of config.import) {
      if (typeof imp === "string" && !imp.includes("*")) {
        if (!imp.startsWith(".") && !imp.startsWith("/")) {
          const pkgName = imp.startsWith("@")
            ? imp.split("/").slice(0, 2).join("/")
            : imp.split("/")[0];
          if (pkgName) adapter.markPackageAsUsed(pkgName);
        } else {
          adapter.markAsUsed(imp);
        }
      }
    }
  }
}

export const LadlePlugin: AnalyzerPlugin = {
  name: "ladle-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for .ladle directory or Ladle config files
    if (await adapter.folderExists(".ladle")) return true;

    for (const configFile of LADLE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for @ladle/react dependency or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.ladle) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (allDeps[LADLE_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bladle\b/.test(s) || s.includes("ladle serve")),
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

      // 1. Protect .ladle folder & config files
      if (await adapter.folderExists(".ladle")) {
        adapter.markAsUsed(".ladle");
      }

      for (const configFile of LADLE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect @ladle/react package dependency
        const isDep =
          (pkg.dependencies && pkg.dependencies[LADLE_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[LADLE_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[LADLE_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(LADLE_PACKAGE_NAME);
        }

        // 3. Protect inline package.json#ladle config block
        if (pkg.ladle) {
          adapter.markAsUsed("package.json", "ladle");
          processLadleConfig(pkg.ladle, adapter);
        }

        // 4. Mark scripts executing ladle CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bladle\b/.test(scriptContent) || scriptContent.includes("ladle serve"))
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

      // Protect .ladle directory files (config.mjs, components.tsx, head.html)
      if (normalized.includes("/.ladle/") || normalized.startsWith(".ladle/")) {
        adapter.markAsUsed(fileId);
      }

      // Mark Ladle story files (*.stories.tsx, *.stories.jsx, *.story.tsx, etc.)
      if (/\.stories\.[jt]sx?$/.test(basename) || /\.story\.[jt]sx?$/.test(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. AST Inspection for .ladle/config files
      if (normalized.includes("/.ladle/")) {
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

      // 2. AST Inspection inside Story files (*.stories.tsx)
      if (/\.stories\.[jt]sx?$/.test(basename) || /\.story\.[jt]sx?$/.test(basename)) {
        // Mark default export (story meta / options)
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Mark named exports (individual stories: export const Primary = () => ...)
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          if (t.isVariableDeclaration(node.declaration)) {
            for (const decl of node.declaration.declarations) {
              if (t.isVariableDeclarator(decl) && t.isIdentifier(decl.id)) {
                adapter.markAsUsed(fileId, decl.id.name);
              }
            }
          }

          if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
            adapter.markAsUsed(fileId, node.declaration.id.name);
          }
        }
      }
    },
  },
};

export default LadlePlugin;
