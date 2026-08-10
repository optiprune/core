import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Fumadocs configuration and source files
 */
const FUMADOCS_CONFIG_FILES = [
  "source.config.ts",
  "source.config.js",
  "source.config.mjs",
  "source.config.cjs",
  "mdx-components.tsx",
  "mdx-components.jsx",
  "mdx-components.js"
];

const FUMADOCS_PACKAGES = [
  "fumadocs-ui",
  "fumadocs-core",
  "fumadocs-docgen",
  "fumadocs-openapi",
  "fumadocs-mdx",
  "fumadocs-typescript"
];

export const FumadocsPlugin: AnalyzerPlugin = {
  name: "fumadocs-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for Fumadocs source config or content folder
    for (const configFile of FUMADOCS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    if (
      (await adapter.folderExists("content/docs")) ||
      (await adapter.folderExists("content"))
    ) {
      // Verify fumadocs dependency in package.json to prevent false positives with generic content/ folders
      const pkg = await adapter.readJson("package.json");
      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        if (FUMADOCS_PACKAGES.some((p) => p in allDeps)) {
          return true;
        }
      }
    }

    // 2. Check package.json for Fumadocs packages or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep.startsWith("fumadocs-") || dep === "fumadocs"
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bfumadocs-mdx\b/.test(s) || /\bfumadocs\b/.test(s))
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

      // 1. Protect dedicated Fumadocs config files
      for (const configFile of FUMADOCS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect content directories (e.g. content/docs/)
      if (await adapter.folderExists("content/docs")) {
        adapter.markAsUsed("content/docs");
      } else if (await adapter.folderExists("content")) {
        adapter.markAsUsed("content");
      }

      if (pkg) {
        // 3. Protect all fumadocs-* packages in package.json dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("fumadocs-") || depName === "fumadocs") {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 4. Mark scripts executing fumadocs CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bfumadocs-mdx\b/.test(scriptContent) || /\bfumadocs\b/.test(scriptContent))
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
      if (FUMADOCS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Protect docs content files (.md, .mdx, .json inside content/docs/ or content/)
      if (
        normalized.includes("/content/docs/") ||
        normalized.startsWith("content/docs/") ||
        normalized.includes("/content/") ||
        normalized.startsWith("content/")
      ) {
        adapter.markAsUsed(fileId);
      }

      // Protect Fumadocs API routes (e.g. app/api/search/route.ts)
      if (
        normalized.includes("/app/api/search/") ||
        normalized.includes("/api/search/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect source.config.ts AST for defineDocs / defineConfig exports
      if (basename.startsWith("source.config.")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (t.isExportNamedDeclaration(node) && node.declaration) {
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Retain imports from fumadocs-core, fumadocs-ui, etc.
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("fumadocs-") || source === "fumadocs") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default FumadocsPlugin;