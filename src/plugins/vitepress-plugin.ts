import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VITEPRESS_CONFIG_FILES = [
  ".vitepress/config.ts",
  ".vitepress/config.js",
  ".vitepress/config.mjs",
  ".vitepress/config.cjs",
  ".vitepress/config.mts",
  ".vitepress/config.cts"
];

const VITEPRESS_PACKAGES = [
  "vitepress",
  "vue",
  "@docsearch/js",
  "@docsearch/css"
];

export const VitepressPlugin: AnalyzerPlugin = {
  name: "vitepress-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };
      if (VITEPRESS_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && s.includes("vitepress")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of VITEPRESS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists(".vitepress");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasVitepressDep = VITEPRESS_PACKAGES.some((p) => p in allDeps);

      // 1. Safeguard installed VitePress ecosystem packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // 2. Protect standalone config files and .vitepress folder
      let hasConfigFile = false;
      for (const configFile of VITEPRESS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists(".vitepress")) {
        hasConfigFile = true;
        adapter.markAsUsed(".vitepress");
      }

      // 3. Track npm scripts invoking VitePress CLI (e.g. "docs:dev": "vitepress dev docs")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            scriptContent.includes("vitepress")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("vitepress");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without vitepress package
      if (hasConfigFile && !hasVitepressDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "VitePress configuration found, but 'vitepress' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Mark VitePress configuration and theme files under .vitepress/
      if (
        normalized.includes(".vitepress/") ||
        VITEPRESS_CONFIG_FILES.includes(basename)
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vitepress");
      }

      // 2. Mark custom theme components or extensions (.vitepress/theme/index.ts)
      if (normalized.includes(".vitepress/theme/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("vitepress");
      }

      // 3. Mark documentation content entry files (*.md in root or docs/)
      if (
        basename.endsWith(".md") &&
        (normalized.includes("/docs/") || !normalized.includes("/"))
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile =
        normalized.includes(".vitepress/") ||
        VITEPRESS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for vitepress and Vue in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "vitepress" ||
          source.startsWith("vitepress/") ||
          source === "vue"
        ) {
          adapter.markPackageAsUsed(source.split("/")[0] ?? source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In VitePress configuration or theme files (.vitepress/config.ts / .vitepress/theme/index.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("vitepress");
        }

        // Detect defineConfig(...) call expressions
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("vitepress");
        }

        // Extract themeConfig properties (e.g. search, algolia, nav, sidebar)
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "search"
        ) {
          if (t.isObjectExpression(node.value)) {
            node.value.properties.forEach((prop: any) => {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === "provider" &&
                t.isStringLiteral(prop.value) &&
                prop.value.value === "algolia"
              ) {
                adapter.markPackageAsUsed("@docsearch/js");
              }
            });
          }
        }
      }
    }
  }
};

export default VitepressPlugin;