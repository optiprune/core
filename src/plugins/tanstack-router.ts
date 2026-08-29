import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized TanStack Router configuration and generated manifest files
 */
const TANSTACK_ROUTER_CONFIG_FILES = ["tsr.config.json", "routeTree.gen.ts", "routeTree.gen.js"];

const TANSTACK_ROUTER_PACKAGES = [
  "@tanstack/react-router",
  "@tanstack/solid-router",
  "@tanstack/router-vite-plugin",
  "@tanstack/router-cli",
  "@tanstack/router-plugin",
  "@tanstack/router-devtools",
  "@tanstack/react-router-devtools",
  "@tanstack/solid-router-devtools",
];

const TANSTACK_ROUTER_ROUTE_EXPORTS = new Set([
  "Route",
  "component",
  "loader",
  "action",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
]);

/**
 * Helper to check if a source file resides in TanStack Router's route directory convention
 */
function isTanStackRouteFile(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/routes/") ||
    normalizedPath.startsWith("routes/") ||
    normalizedPath.includes("/src/routes/") ||
    normalizedPath.startsWith("src/routes/") ||
    normalizedPath.includes("/app/routes/") ||
    normalizedPath.startsWith("app/routes/")
  );
}

export const TanStackRouterPlugin: AnalyzerPlugin = {
  name: "tanstack-router-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated TanStack Router route directory or routeTree generator
    if (
      (await adapter.folderExists("src/routes")) ||
      (await adapter.folderExists("routes")) ||
      (await adapter.folderExists("app/routes"))
    ) {
      return true;
    }

    for (const configFile of TANSTACK_ROUTER_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for @tanstack/*router* dependencies or tsr CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some((dep) => dep.startsWith("@tanstack/") && dep.includes("router"))
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\btsr\b/.test(s) || s.includes("tsr generate") || s.includes("tsr watch")),
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

      // 1. Protect generated routeTree manifest & tsr.config.json
      for (const configFile of TANSTACK_ROUTER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect file-based route directories
      const routeFolders = ["src/routes", "routes", "app/routes"];
      for (const folder of routeFolders) {
        if (await adapter.folderExists(folder)) {
          adapter.markAsUsed(folder);
        }
      }

      if (pkg) {
        // 3. Protect all @tanstack/*router* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@tanstack/") && depName.includes("router")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Mark npm scripts executing tsr (TanStack Router CLI) as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\btsr\b/.test(scriptContent) ||
                scriptContent.includes("tsr generate") ||
                scriptContent.includes("tsr watch"))
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

      // Protect config & auto-generated routeTree files
      if (
        TANSTACK_ROUTER_CONFIG_FILES.includes(basename) ||
        basename.startsWith("routeTree.gen.")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@tanstack/react-router");
      }

      // Protect all route files inside routes/ directory
      if (isTanStackRouteFile(normalized)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Inspect route files for createFileRoute / createRootRoute / Route exports
      if (isTanStackRouteFile(normalized)) {
        // Detect export const Route = createFileRoute(...)
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          const decl = node.declaration;

          if (t.isVariableDeclaration(decl)) {
            decl.declarations.forEach((vDecl: any) => {
              if (t.isIdentifier(vDecl.id) && TANSTACK_ROUTER_ROUTE_EXPORTS.has(vDecl.id.name)) {
                adapter.markAsUsed(fileId, vDecl.id.name);
              }
            });
          }

          if (t.isFunctionDeclaration(decl) && decl.id) {
            if (TANSTACK_ROUTER_ROUTE_EXPORTS.has(decl.id.name)) {
              adapter.markAsUsed(fileId, decl.id.name);
            }
          }
        }
      }

      // 2. Detect createFileRoute(...) or createRootRoute(...) call expressions
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const fnName = node.callee.name;
        if (
          [
            "createFileRoute",
            "createRootRoute",
            "createRoute",
            "createLazyRoute",
            "createLazyFileRoute",
          ].includes(fnName)
        ) {
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Retain imports from @tanstack/*router*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@tanstack/") && source.includes("router")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default TanStackRouterPlugin;
