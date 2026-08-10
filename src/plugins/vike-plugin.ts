import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Vike configuration and extension files
 */
const VIKE_CONFIG_FILES = [
  "+config.h.js",
  "+config.h.ts",
  "vike.config.js",
  "vike.config.ts"
];

const VIKE_CORE_PACKAGES = [
  "vike",
  "vike-react",
  "vike-vue",
  "vike-solid",
  "vike-node",
  "vite-plugin-ssr"
];

/**
 * Helper to check if a file basename follows Vike routing/hook conventions (+Page, +Layout, etc.)
 */
function isVikeFile(basename: string): boolean {
  return basename.startsWith("+") || basename.startsWith("renderer/");
}

export const VikePlugin: AnalyzerPlugin = {
  name: "vike-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for pages/ or renderer/ directories
    if (
      (await adapter.folderExists("pages")) ||
      (await adapter.folderExists("renderer"))
    ) {
      // Verify vike or vite-plugin-ssr dependency in package.json
      const pkg = await adapter.readJson("package.json");
      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };
        if (VIKE_CORE_PACKAGES.some((p) => p in allDeps)) {
          return true;
        }
      }
    }

    // 2. Check package.json for vike or vite-plugin-ssr dependencies or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "vike" || dep.startsWith("vike-") || dep === "vite-plugin-ssr"
        )
      ) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect pages/ and renderer/ directories
      if (await adapter.folderExists("pages")) {
        adapter.markAsUsed("pages");
      }
      if (await adapter.folderExists("renderer")) {
        adapter.markAsUsed("renderer");
      }

      if (pkg) {
        // 2. Protect all vike, vike-*, and vite-plugin-ssr packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "vike" ||
            depName.startsWith("vike-") ||
            depName === "vite-plugin-ssr"
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Vike special files (+Page, +config.h, +Layout, +onBeforeRender, etc.)
      if (
        isVikeFile(basename) ||
        normalized.includes("/pages/") ||
        normalized.startsWith("pages/") ||
        normalized.includes("/renderer/") ||
        normalized.startsWith("renderer/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Protect exports in Vike route files (+Page.tsx, +onBeforeRender.ts, etc.)
      if (
        isVikeFile(basename) ||
        normalized.includes("/pages/") ||
        normalized.includes("/renderer/")
      ) {
        // Default export (Page component or config object)
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Named hooks exports (export { onBeforeRender }, export { passToClient })
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Retain imports from vike, vike-*, or vite-plugin-ssr
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "vike" ||
          source.startsWith("vike/") ||
          source.startsWith("vike-") ||
          source === "vite-plugin-ssr"
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default VikePlugin;