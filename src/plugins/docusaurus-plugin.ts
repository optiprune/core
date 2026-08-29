import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const DOCUSAURUS_CONFIG_FILES = [
  "docusaurus.config.js",
  "docusaurus.config.ts",
  "docusaurus.config.mjs",
  "docusaurus.config.cjs",
  "sidebars.js",
  "sidebars.ts",
  "sidebars.json",
];

const DOCUSAURUS_PACKAGES = [
  "@docusaurus/core",
  "@docusaurus/preset-classic",
  "@docusaurus/preset-bootstrap",
  "@docusaurus/theme-classic",
  "@docusaurus/theme-common",
  "@docusaurus/theme-search-algolia",
  "@docusaurus/theme-live-codeblock",
  "@docusaurus/theme-mermaid",
  "@docusaurus/plugin-content-docs",
  "@docusaurus/plugin-content-blog",
  "@docusaurus/plugin-content-pages",
  "@docusaurus/plugin-pwa",
  "@docusaurus/plugin-google-analytics",
  "@docusaurus/plugin-google-gtag",
  "@docusaurus/plugin-ideal-image",
  "@docusaurus/module-type-aliases",
];

export const DocusaurusPlugin: AnalyzerPlugin = {
  name: "docusaurus-plugin",
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
          (dep) => dep === "@docusaurus/core" || dep.startsWith("@docusaurus/"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && s.includes("docusaurus"))) {
          return true;
        }
      }
    }

    for (const configFile of DOCUSAURUS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (await adapter.folderExists("docs")) && (await adapter.folderExists("src/pages"));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasDocusaurus = Object.keys(allDeps).some(
        (p) => p === "@docusaurus/core" || p.startsWith("@docusaurus/"),
      );

      // 1. Safeguard all installed @docusaurus/* packages in package.json
      if (hasDocusaurus) {
        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@docusaurus/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect config files and sidebars
      let hasConfigFile = false;
      for (const configFile of DOCUSAURUS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Docusaurus CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("docusaurus")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@docusaurus/core");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without @docusaurus/core
      if (hasConfigFile && !hasDocusaurus) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Docusaurus configuration found, but '@docusaurus/core' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Configuration & sidebars files
      if (DOCUSAURUS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@docusaurus/core");
      }

      // 2. Docusaurus source components, pages, custom themes/swizzling, docs, and blog
      if (
        normalized.includes("/src/pages/") ||
        normalized.includes("/src/components/") ||
        normalized.includes("/src/theme/") ||
        normalized.includes("/src/css/") ||
        normalized.includes("/docs/") ||
        normalized.includes("/blog/") ||
        normalized.includes("/static/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@docusaurus/core");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = DOCUSAURUS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @docusaurus/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@docusaurus/") || source.startsWith("@theme/")) {
          if (source.startsWith("@docusaurus/")) {
            adapter.markPackageAsUsed(source);
          }
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Docusaurus configuration files (docusaurus.config.js / sidebars.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@docusaurus/core");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@docusaurus/core");
        }

        // Detect presets array: presets: [['classic', { ... }]]
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "presets") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              if (t.isArrayExpression(el) && el.elements[0]) {
                const presetName = el.elements[0];
                if (t.isStringLiteral(presetName)) {
                  const val = presetName.value;
                  const fullPkg = val.startsWith("@") ? val : `@docusaurus/preset-${val}`;
                  adapter.markPackageAsUsed(fullPkg);
                }
              } else if (t.isStringLiteral(el)) {
                const val = el.value;
                const fullPkg = val.startsWith("@") ? val : `@docusaurus/preset-${val}`;
                adapter.markPackageAsUsed(fullPkg);
              }
            });
          }
        }

        // Detect plugins array: plugins: ['@docusaurus/plugin-ideal-image', ...]
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "plugins") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              let pluginNameNode = el;
              if (t.isArrayExpression(el) && el.elements[0]) {
                pluginNameNode = el.elements[0];
              }

              if (t.isStringLiteral(pluginNameNode)) {
                const val = pluginNameNode.value;
                const fullPkg = val.startsWith("@") ? val : `@docusaurus/plugin-${val}`;
                adapter.markPackageAsUsed(fullPkg);
              }
            });
          }
        }
      }
    },
  },
};

export default DocusaurusPlugin;
