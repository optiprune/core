import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SVGR_CONFIG_FILES = [
  ".svgrrc",
  ".svgrrc.json",
  ".svgrrc.yaml",
  ".svgrrc.yml",
  ".svgrrc.js",
  ".svgrrc.cjs",
  ".svgrrc.mjs",
  ".svgrrc.ts",
  "svgr.config.js",
  "svgr.config.cjs",
  "svgr.config.mjs",
  "svgr.config.ts",
];

const SVGR_PACKAGES = [
  "@svgr/core",
  "@svgr/cli",
  "@svgr/webpack",
  "@svgr/rollup",
  "@svgr/plugin-jsx",
  "@svgr/plugin-svgo",
  "@svgr/plugin-prettier",
  "vite-plugin-svgr",
];

export const SvgrPlugin: AnalyzerPlugin = {
  name: "svgr-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep.startsWith("@svgr/") || dep === "vite-plugin-svgr" || dep === "svgr",
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some((s) => typeof s === "string" && (s.includes("svgr") || s === "svgr"))
        ) {
          return true;
        }
      }
    }

    for (const configFile of SVGR_CONFIG_FILES) {
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

      const hasSvgr = Object.keys(allDeps).some(
        (p) => p.startsWith("@svgr/") || p === "vite-plugin-svgr" || p === "svgr",
      );

      // 1. Safeguard installed SVGR ecosystem packages in package.json
      if (hasSvgr) {
        for (const depName of SVGR_PACKAGES) {
          if (allDeps[depName]) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of SVGR_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking SVGR CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("svgr") || scriptContent === "svgr")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@svgr/cli");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without SVGR
      if (hasConfigFile && !hasSvgr) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "SVGR configuration found, but '@svgr/core' or '@svgr/cli' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (SVGR_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@svgr/core");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SVGR_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @svgr/* or vite-plugin-svgr
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@svgr/") || source === "vite-plugin-svgr") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }

        // Detect SVG component import queries: import { ReactComponent as Icon } from './icon.svg?react'
        if (source.endsWith(".svg") || source.includes(".svg?") || source.includes(".svg?react")) {
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In SVGR config files (svgr.config.js / .svgrrc.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@svgr/core");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@svgr/core");
        }

        // Extract SVGR plugin list: plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx']
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "plugins") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(el.value);
              }
            });
          }
        }
      }
    },
  },
};

export default SvgrPlugin;
