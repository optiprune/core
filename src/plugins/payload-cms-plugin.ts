import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PAYLOAD_CONFIG_FILES = [
  "payload.config.ts",
  "payload.config.js",
  "payload.config.mjs",
  "payload.config.cjs",
  "src/payload.config.ts",
  "src/payload.config.js"
];

const PAYLOAD_CORE_PACKAGES = [
  "payload",
  "@payloadcms/next",
  "@payloadcms/db-postgres",
  "@payloadcms/db-mongodb",
  "@payloadcms/db-sqlite",
  "@payloadcms/db-vercel-postgres",
  "@payloadcms/richtext-slate",
  "@payloadcms/richtext-lexical",
  "@payloadcms/bundler-webpack",
  "@payloadcms/bundler-vite",
  "@payloadcms/plugin-cloud",
  "@payloadcms/plugin-seo",
  "@payloadcms/plugin-nested-docs",
  "@payloadcms/plugin-redirects",
  "@payloadcms/plugin-form-builder",
  "@payloadcms/plugin-search"
];

export const PayloadCMSPlugin: AnalyzerPlugin = {
  name: "payload-cms-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for payload.config files
    for (const configFile of PAYLOAD_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json dependencies for payload / @payloadcms packages
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (Object.keys(allDeps).some((dep) => dep === "payload" || dep.startsWith("@payloadcms/"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("payload ") || s === "payload")
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

      // 1. Mark payload configuration files as used
      for (const configFile of PAYLOAD_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect Payload dependencies
      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === "payload" || depName.startsWith("@payloadcms/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Mark package.json scripts executing payload CLI commands
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (scriptContent.includes("payload ") || scriptContent === "payload")
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

      // Protect explicit payload config file
      if (PAYLOAD_CONFIG_FILES.some((cfg) => normalized.endsWith(cfg))) {
        adapter.markAsUsed(fileId);
      }

      // Protect typical Payload CMS architecture conventions (collections, globals, blocks, hooks, access control)
      if (
        normalized.includes("/collections/") ||
        normalized.includes("/globals/") ||
        normalized.includes("/blocks/") ||
        normalized.includes("/hooks/") ||
        normalized.includes("/access/") ||
        normalized.includes("/endpoints/") ||
        normalized.includes("/fields/") ||
        normalized.includes("/payload/")
      ) {
        adapter.markAsUsed(fileId);
      }

      // Payload 3.0 Next.js App Router admin integration route: /app/(payload)/...
      if (normalized.includes("/(payload)/")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // AST inspection inside payload.config.ts / .js
      if (PAYLOAD_CONFIG_FILES.some((cfg) => normalized.endsWith(cfg))) {
        // Handle export default buildConfig({...})
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Track plugin dependencies or adapter imports passed inside buildConfig()
        if (t.isCallExpression(node)) {
          if (
            t.isIdentifier(node.callee) &&
            (node.callee.name === "postgresAdapter" ||
              node.callee.name === "mongooseAdapter" ||
              node.callee.name === "sqliteAdapter" ||
              node.callee.name === "slateEditor" ||
              node.callee.name === "lexicalEditor" ||
              node.callee.name === "webpackBundler" ||
              node.callee.name === "viteBundler")
          ) {
            adapter.markAsUsed(fileId);
          }
        }
      }
    }
  }
};

export default PayloadCMSPlugin;