import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NETLIFY_CONFIG_FILES = [
  "netlify.toml",
  "_redirects",
  "_headers",
  "_redirects.json"
];

const NETLIFY_PACKAGES = [
  "@netlify/functions",
  "@netlify/edge-functions",
  "@netlify/blobs",
  "@netlify/env",
  "@netlify/serverless-functions-api",
  "netlify-cli",
  "@netlify/plugin-lighthouse",
  "@netlify/plugin-sitemap",
  "@netlify/remix-adapter",
  "@netlify/next"
];

const NETLIFY_SPECIAL_EXPORTS = new Set([
  "handler",
  "config",
  "default"
]);

export const NetlifyPlugin: AnalyzerPlugin = {
  name: "netlify-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (NETLIFY_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of NETLIFY_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("netlify/functions")) ||
      (await adapter.folderExists("netlify/edge-functions"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasNetlifyDep = NETLIFY_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const file of NETLIFY_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
        }
      }

      // Mark all installed @netlify/* packages as used in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts that execute netlify CLI (e.g. "dev": "netlify dev")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("netlify ") || scriptContent.includes("netlify-cli"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("netlify-cli");
          }
        }
      }

      // Inspect netlify.toml for custom functions / edge_functions directory declarations
      const netlifyToml = await adapter.readFile("netlify.toml");
      if (netlifyToml) {
        const functionsDirMatch = netlifyToml.match(/functions\s*=\s*["']([^"']+)["']/);
        if (functionsDirMatch?.[1]) {
          adapter.markAsUsed(functionsDirMatch[1]);
        }

        const edgeFunctionsDirMatch = netlifyToml.match(/edge_functions\s*=\s*["']([^"']+)["']/);
        if (edgeFunctionsDirMatch?.[1]) {
          adapter.markAsUsed(edgeFunctionsDirMatch[1]);
        }
      }

      if (hasConfigFile && !hasNetlifyDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "info",
          confidence: "medium",
          file: "package.json",
          message: "Netlify configuration or functions found. Consider adding '@netlify/functions' to package.json for type definitions.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Config and redirection files
      if (NETLIFY_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // 2. Netlify Functions v1 & v2 (netlify/functions/* or .netlify/functions-internal/*)
      if (
        normalized.includes("/netlify/functions/") ||
        normalized.includes("/.netlify/functions-internal/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@netlify/functions");
      }

      // 3. Netlify Edge Functions (netlify/edge-functions/*)
      if (normalized.includes("/netlify/edge-functions/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@netlify/edge-functions");
      }

      // 4. Custom Local Netlify Build Plugins (netlify/plugins/*)
      if (normalized.includes("/netlify/plugins/")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const isNetlifyFunction =
        normalized.includes("/netlify/functions/") ||
        normalized.includes("/netlify/edge-functions/");

      // 1. Detect @netlify/* imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@netlify/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@netlify/*')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value.startsWith("@netlify/")) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Netlify function wrappers (schedule, builder, stream)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const funcName = node.callee.name;
        if (["schedule", "builder", "stream"].includes(funcName)) {
          adapter.markPackageAsUsed("@netlify/functions");
          adapter.markAsUsed(fileId);
        }
      }

      // 4. Protect Netlify Function exports inside function files
      if (isNetlifyFunction) {
        // Handle export const handler = async () => ... or export const config = { path: "/api/*" }
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          const decl = node.declaration;

          if (t.isFunctionDeclaration(decl) && decl.id) {
            if (NETLIFY_SPECIAL_EXPORTS.has(decl.id.name)) {
              adapter.markAsUsed(fileId, decl.id.name);
            }
          }

          if (t.isVariableDeclaration(decl)) {
            decl.declarations.forEach((vDecl: any) => {
              if (t.isIdentifier(vDecl.id) && NETLIFY_SPECIAL_EXPORTS.has(vDecl.id.name)) {
                adapter.markAsUsed(fileId, vDecl.id.name);
              }
            });
          }
        }

        // Handle export default async function () ... (Netlify Functions v2 & Edge Functions)
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default NetlifyPlugin;