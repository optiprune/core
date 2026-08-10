import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CONVEX_CONFIG_FILES = [
  "convex.json",
  "convexrc.json"
];

const CONVEX_SPECIAL_FILES = [
  "schema.ts",
  "schema.js",
  "http.ts",
  "http.js",
  "_generated/api.d.ts",
  "_generated/api.js",
  "_generated/server.d.ts",
  "_generated/server.js"
];

const CONVEX_FUNCTIONS = new Set([
  "query",
  "mutation",
  "action",
  "internalQuery",
  "internalMutation",
  "internalAction",
  "httpAction"
]);

export const ConvexPlugin: AnalyzerPlugin = {
  name: "convex-plugin",
  version: "1.0.0",

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
          (dep) => dep === "convex" || dep.startsWith("@convex-dev/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("convex ") || s === "convex")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of CONVEX_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("convex");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasConvex = Object.keys(allDeps).some(
        (p) => p === "convex" || p.startsWith("@convex-dev/")
      );

      // 1. Safeguard installed Convex packages in package.json
      if (hasConvex) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "convex" || depName.startsWith("@convex-dev/")) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone config files and convex/ directory
      let hasConfigFile = false;
      for (const configFile of CONVEX_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      const hasConvexDir = await adapter.folderExists("convex");
      if (hasConvexDir) {
        adapter.markAsUsed("convex");
      }

      // 3. Track npm scripts invoking Convex CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("convex ") || scriptContent === "convex")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("convex");
          }
        }
      }

      // 4. Report missing dependency if convex folder/config exists without convex package
      if ((hasConfigFile || hasConvexDir) && !hasConvex) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Convex configuration or 'convex/' folder found, but 'convex' is not listed in package.json.",
          evidence: { hasConfigFile, hasConvexDir }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Convex config files
      if (CONVEX_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("convex");
      }

      // Protect all backend code inside convex/ directory
      if (normalized.includes("/convex/") || normalized.startsWith("convex/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("convex");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Detect ESM imports for convex packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "convex" || source.startsWith("convex/") || source.startsWith("@convex-dev/")) {
          adapter.markPackageAsUsed(source.startsWith("@convex-dev/") ? source : "convex");
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In files under convex/ directory
      if (normalized.includes("/convex/") || normalized.startsWith("convex/")) {
        // Protect schema.ts and http.ts default/named exports
        if (CONVEX_SPECIAL_FILES.includes(basename)) {
          if (t.isExportDefaultDeclaration(node)) {
            adapter.markAsUsed(fileId, "default");
          }
          if (t.isExportNamedDeclaration(node)) {
            adapter.markAsUsed(fileId);
          }
        }

        // Detect exported backend functions: export const myQuery = query({ ... })
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          const decl = node.declaration;

          if (t.isVariableDeclaration(decl)) {
            decl.declarations.forEach((d: any) => {
              if (t.isIdentifier(d.id) && d.init) {
                const init = d.init;

                // Match query({ ... }), mutation({ ... }), action({ ... })
                if (
                  t.isCallExpression(init) &&
                  t.isIdentifier(init.callee) &&
                  CONVEX_FUNCTIONS.has(init.callee.name)
                ) {
                  adapter.markAsUsed(fileId, d.id.name);
                  adapter.markPackageAsUsed("convex");
                }
              }
            });
          }
        }
      }
    }
  }
};

export default ConvexPlugin;