import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized MDX provider and configuration files
 */
const MDX_PROVIDER_FILES = [
  "mdx-components.tsx",
  "mdx-components.jsx",
  "mdx-components.js",
  "mdx-components.ts",
];

const MDX_CORE_PACKAGES = [
  "@mdx-js/mdx",
  "@mdx-js/react",
  "@mdx-js/vue",
  "@mdx-js/node",
  "@mdx-js/loader",
  "@mdx-js/rollup",
  "@mdx-js/esbuild",
  "@next/mdx",
  "@astrojs/mdx",
];

/**
 * Helper to determine if a package is an MDX compiler, wrapper, or remark/rehype plugin
 */
function isMdxPackage(source: string): boolean {
  return (
    source === "mdx" ||
    source.startsWith("@mdx-js/") ||
    source.startsWith("remark-") ||
    source.startsWith("rehype-") ||
    source === "@next/mdx" ||
    source === "@astrojs/mdx"
  );
}

export const MdxPlugin: AnalyzerPlugin = {
  name: "mdx-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated MDX provider files
    for (const configFile of MDX_PROVIDER_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for MDX or remark/rehype dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => isMdxPackage(dep))) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated MDX provider mapping files (e.g. mdx-components.tsx)
      for (const configFile of MDX_PROVIDER_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all @mdx-js/*, remark-*, and rehype-* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (isMdxPackage(depName)) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect provider files
      if (MDX_PROVIDER_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@mdx-js/react");
      }

      // Automatically mark .mdx documents as used entry points
      if (normalized.endsWith(".mdx") || normalized.endsWith(".md")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@mdx-js/mdx");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect mdx-components.tsx/jsx AST for default function useMDXComponents(components) export
      if (MDX_PROVIDER_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (t.isExportNamedDeclaration(node) && node.declaration) {
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Retain imports from @mdx-js/*, remark-*, or rehype-*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (isMdxPackage(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default MdxPlugin;
