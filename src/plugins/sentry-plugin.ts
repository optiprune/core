import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SENTRY_PACKAGES = [
  "@sentry/node",
  "@sentry/browser",
  "@sentry/react",
  "@sentry/vue",
  "@sentry/angular",
  "@sentry/nextjs",
  "@sentry/sveltekit",
  "@sentry/remix",
  "@sentry/astro",
  "@sentry/nuxt",
  "@sentry/react-native",
  "@sentry/electron",
  "@sentry/serverless",
  "@sentry/vite-plugin",
  "@sentry/webpack-plugin",
  "@sentry/babel-plugin",
  "@sentry/cli",
  "@sentry/tracing",
  "@sentry/profiling-node",
];

const SENTRY_CONFIG_FILES = [
  "sentry.server.config.ts",
  "sentry.server.config.js",
  "sentry.client.config.ts",
  "sentry.client.config.js",
  "sentry.edge.config.ts",
  "sentry.edge.config.js",
  "sentry.properties",
  ".sentryclirc",
];

export const SentryPlugin: AnalyzerPlugin = {
  name: "sentry-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => dep === "@sentry/cli" || dep.startsWith("@sentry/"))) {
        return true;
      }
    }

    for (const configFile of SENTRY_CONFIG_FILES) {
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

      const hasSentry = Object.keys(allDeps).some(
        (p) => p === "@sentry/cli" || p.startsWith("@sentry/"),
      );

      let hasConfigFile = false;
      for (const configFile of SENTRY_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 1. Safeguard installed Sentry packages in package.json
      if (hasSentry) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "@sentry/cli" || depName.startsWith("@sentry/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Track npm scripts invoking Sentry CLI or sourcemap uploads
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("sentry-cli") || scriptContent.includes("@sentry/"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@sentry/cli");
          }
        }
      }

      if (hasConfigFile && !hasSentry) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Sentry configuration files found, but '@sentry/*' packages are not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Sentry configuration files (Next.js, Edge, Server, Client configs)
      if (SENTRY_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("@sentry/nextjs");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SENTRY_CONFIG_FILES.includes(basename);

      // 1. Protect ESM imports for @sentry/* packages in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "@sentry/cli" || source.startsWith("@sentry/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Protect CJS require('@sentry/*') calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "@sentry/cli" || arg.value.startsWith("@sentry/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect Sentry.init({ dsn: ... }) calls
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        const prop = node.callee.property;

        if (
          t.isIdentifier(obj) &&
          obj.name === "Sentry" &&
          t.isIdentifier(prop) &&
          prop.name === "init"
        ) {
          adapter.markAsUsed(fileId);
        }
      }

      // 4. In Sentry config files (sentry.client.config.ts, etc.), protect exports
      if (isConfigFile && t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }
    },
  },
};

export default SentryPlugin;
