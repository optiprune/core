import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const REMIX_ROUTE_REGEX = /\/app\/(routes\/|root\.[jt]sx?$)/;

const REMIX_CONFIG_FILES = [
  "remix.config.js",
  "remix.config.ts",
  "remix.config.mjs",
  "remix.config.cjs",
  "react-router.config.ts",
  "react-router.config.js"
];

const REMIX_EXPORTS = new Set([
  "loader",
  "clientLoader",
  "action",
  "clientAction",
  "meta",
  "headers",
  "links",
  "handle",
  "shouldRevalidate",
  "HydrateFallback",
  "ErrorBoundary",
  "stale",
  "default"
]);

const REMIX_PACKAGES = [
  "@remix-run/react",
  "@remix-run/serve",
  "@remix-run/node",
  "@remix-run/cloudflare",
  "@remix-run/deno",
  "@remix-run/express",
  "@remix-run/dev",
  "@remix-run/router",
  "@react-router/dev",
  "@react-router/node",
  "react-router"
];

export const RemixPlugin: AnalyzerPlugin = {
  name: "remix-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "react-router" ||
            dep.startsWith("@remix-run/") ||
            dep.startsWith("@react-router/")
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
              (s.includes("remix ") || s.includes("react-router "))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of REMIX_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("app/routes");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasRemixDep = Object.keys(allDeps).some(
        (p) =>
          p === "react-router" ||
          p.startsWith("@remix-run/") ||
          p.startsWith("@react-router/")
      );

      // 1. Safeguard installed Remix & React Router packages in package.json
      if (hasRemixDep) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "react-router" ||
            depName.startsWith("@remix-run/") ||
            depName.startsWith("@react-router/")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect config files
      let hasConfigFile = false;
      for (const configFile of REMIX_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Remix or React Router CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("remix") ||
              scriptContent.includes("react-router"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@remix-run/dev");
          }
        }
      }

      // 4. Report missing dependency if config exists without Remix package
      if (hasConfigFile && !hasRemixDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Remix/React Router configuration found, but '@remix-run/dev' or 'react-router' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Configuration files
      if (REMIX_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@remix-run/dev");
      }

      // 2. Route files, Root component, Entry Server, and Entry Client
      if (
        REMIX_ROUTE_REGEX.test(normalized) ||
        normalized.includes("/app/entry.client.") ||
        normalized.includes("/app/entry.server.")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@remix-run/react");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = REMIX_CONFIG_FILES.includes(basename);
      const isRouteFile = REMIX_ROUTE_REGEX.test(normalized);

      // 1. Protect ESM imports for @remix-run/* packages in any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "react-router" ||
          source.startsWith("@remix-run/") ||
          source.startsWith("@react-router/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Remix configuration files (remix.config.js / react-router.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@remix-run/dev");
        }
      }

      // 3. In Route files (/app/routes/* or /app/root.tsx)
      if (isRouteFile) {
        if (node?.type === "ExportNamedDeclaration") {
          // export const loader = ... / export function loader() {}
          if (node.declaration) {
            const decl = node.declaration;
            if (
              t.isFunctionDeclaration(decl) &&
              decl.id?.name &&
              REMIX_EXPORTS.has(decl.id.name)
            ) {
              adapter.markAsUsed(fileId, decl.id.name);
            } else if (t.isVariableDeclaration(decl)) {
              for (const d of decl.declarations) {
                if (t.isIdentifier(d.id) && REMIX_EXPORTS.has(d.id.name)) {
                  adapter.markAsUsed(fileId, d.id.name);
                }
              }
            }
          }

          // export { loader, action }
          if (Array.isArray(node.specifiers)) {
            for (const spec of node.specifiers) {
              const exportName = spec.exported?.name || spec.exported?.value;
              if (typeof exportName === "string" && REMIX_EXPORTS.has(exportName)) {
                adapter.markAsUsed(fileId, exportName);
              }
            }
          }
        }

        // export default Component
        if (node?.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default RemixPlugin;