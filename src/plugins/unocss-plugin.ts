import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const UNOCSS_CONFIG_FILES = [
  "uno.config.ts",
  "uno.config.js",
  "uno.config.mjs",
  "uno.config.cjs",
  "uno.config.mts",
  "uno.config.cts",
  "unocss.config.ts",
  "unocss.config.js",
  "unocss.config.mjs",
  "unocss.config.cjs",
  "unocss.config.mts",
  "unocss.config.cts",
];

const UNOCSS_PACKAGES = [
  "unocss",
  "@unocss/core",
  "@unocss/vite",
  "@unocss/nuxt",
  "@unocss/webpack",
  "@unocss/postcss",
  "@unocss/cli",
  "@unocss/preset-uno",
  "@unocss/preset-mini",
  "@unocss/preset-wind",
  "@unocss/preset-attributify",
  "@unocss/preset-icons",
  "@unocss/preset-typography",
  "@unocss/preset-web-fonts",
  "@unocss/preset-tagify",
  "@unocss/preset-rem-to-px",
];

export const UnocssPlugin: AnalyzerPlugin = {
  name: "unocss-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      if (UNOCSS_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of UNOCSS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasUnoDep = UNOCSS_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of UNOCSS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
          break;
        }
      }

      // Safeguard installed UnoCSS ecosystem packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts invoking UnoCSS CLI (e.g. "unocss --watch")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("unocss") || scriptContent.includes("uno "))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("unocss");
          }
        }
      }

      if (hasConfigFile && !hasUnoDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "UnoCSS configuration found but 'unocss' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Mark UnoCSS configuration files
      if (UNOCSS_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("unocss");
      }

      // 2. Mark virtual import files or custom style entry files if applicable
      if (basename.includes("uno.css") || basename.includes("unocss.css")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("unocss");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = UNOCSS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for UnoCSS integrations & presets (e.g. import { defineConfig } from 'unocss')
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "unocss" ||
          source === "uno.css" ||
          source.startsWith("@unocss/") ||
          source.startsWith("unocss-preset-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In UnoCSS config files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("unocss");
        }

        // Detect defineConfig(...) calls
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("unocss");
        }

        // Detect UnoCSS shortcuts, theme, rules, or presets properties
        if (t.isObjectProperty(node) && t.isIdentifier(node.key)) {
          if (
            ["shortcuts", "theme", "rules", "presets", "extractors", "transformers"].includes(
              node.key.name,
            )
          ) {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("unocss");
          }
        }
      }
    },
  },
};

export default UnocssPlugin;
