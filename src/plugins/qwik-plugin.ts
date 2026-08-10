import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const QWIK_CONFIG_FILES = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs"
];

const QWIK_PACKAGES = [
  "@builder.io/qwik",
  "@builder.io/qwik-city",
  "@builder.io/qwik-react",
  "@builder.io/qwik-tailwind",
  "@builder.io/qwik-auth"
];

const QWIK_CITY_EXPORTS = new Set([
  "routeLoader$",
  "routeAction$",
  "server$",
  "onRequest",
  "onGet",
  "onPost",
  "onPut",
  "onDelete",
  "onPatch",
  "head"
]);

export const QwikPlugin: AnalyzerPlugin = {
  name: "qwik-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies
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
            dep === "@builder.io/qwik" ||
            dep.startsWith("@builder.io/qwik-")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("qwik ") || s === "qwik")
          )
        ) {
          return true;
        }
      }
    }

    return (
      (await adapter.folderExists("src/routes")) ||
      (await adapter.folderExists("src/components"))
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

      const hasQwik = Object.keys(allDeps).some(
        (p) => p === "@builder.io/qwik" || p.startsWith("@builder.io/qwik-")
      );

      // 1. Safeguard all installed Qwik ecosystem packages in package.json
      if (hasQwik) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "@builder.io/qwik" ||
            depName.startsWith("@builder.io/qwik-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect Qwik City routes and adapters directories
      const hasRoutesDir = await adapter.folderExists("src/routes");
      if (hasRoutesDir) {
        adapter.markAsUsed("src/routes");
      }

      if (await adapter.folderExists("src/adapters")) {
        adapter.markAsUsed("src/adapters");
      }

      // 3. Track npm scripts invoking Qwik CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("qwik ") || scriptContent === "qwik")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@builder.io/qwik");
          }
        }
      }

      // 4. Report missing dependency if routes directory exists without Qwik packages
      if (hasRoutesDir && !hasQwik) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Qwik City routes directory found, but '@builder.io/qwik' or '@builder.io/qwik-city' is not listed in package.json.",
          evidence: { hasRoutesDir }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Protect all route files inside src/routes/
      if (
        normalized.includes("/src/routes/") ||
        normalized.startsWith("src/routes/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@builder.io/qwik-city");
      }

      // Protect adapter entry files inside src/adapters/
      if (
        normalized.includes("/src/adapters/") ||
        normalized.startsWith("src/adapters/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@builder.io/qwik-city");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const isRouteFile =
        normalized.includes("/src/routes/") ||
        normalized.startsWith("src/routes/");

      // 1. Detect ESM imports for @builder.io/qwik packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "@builder.io/qwik" ||
          source.startsWith("@builder.io/qwik/") ||
          source.startsWith("@builder.io/qwik-")
        ) {
          adapter.markPackageAsUsed(
            source.startsWith("@builder.io/qwik-")
              ? source
              : "@builder.io/qwik"
          );
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect Qwik component$() declarations
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        (node.callee.name === "component$" || node.callee.name.endsWith("$"))
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@builder.io/qwik");
      }

      // 3. Inspect Qwik City route files for default exports and route endpoints
      if (isRouteFile) {
        // Protect export default component$()
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Detect named exports: routeLoader$, routeAction$, onRequest, head
        if (t.isExportNamedDeclaration(node)) {
          if (node.declaration) {
            const decl = node.declaration;

            // export const useData = routeLoader$(...) / export const onRequest = ...
            if (t.isVariableDeclaration(decl)) {
              for (const d of decl.declarations) {
                if (t.isIdentifier(d.id)) {
                  adapter.markAsUsed(fileId, d.id.name);
                }
              }
            }
            // export function onGet() {}
            else if (t.isFunctionDeclaration(decl) && decl.id) {
              adapter.markAsUsed(fileId, decl.id.name);
            }
          }

          // export { onRequest, head }
          if (Array.isArray(node.specifiers)) {
            for (const spec of node.specifiers) {
              const exportName = spec.exported?.name || spec.exported?.value;
              if (
                typeof exportName === "string" &&
                QWIK_CITY_EXPORTS.has(exportName)
              ) {
                adapter.markAsUsed(fileId, exportName);
              }
            }
          }
        }
      }
    }
  }
};

export default QwikPlugin;