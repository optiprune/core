import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SVELTE_CONFIG_FILES = [
  "svelte.config.js",
  "svelte.config.ts",
  "svelte.config.cjs",
  "svelte.config.mjs",
];

const SVELTE_PACKAGES = [
  "svelte",
  "@sveltejs/kit",
  "@sveltejs/adapter-auto",
  "@sveltejs/adapter-node",
  "@sveltejs/adapter-static",
  "@sveltejs/adapter-cloudflare",
  "@sveltejs/adapter-vercel",
  "@sveltejs/adapter-netlify",
  "@sveltejs/vite-plugin-svelte",
  "svelte-preprocess",
  "svelte-check",
];

const SVELTE_LIFECYCLE_APIS = new Set([
  "onMount",
  "onDestroy",
  "beforeUpdate",
  "afterUpdate",
  "tick",
  "createEventDispatcher",
  "setContext",
  "getContext",
  "hasContext",
  "getAllContexts",
]);

const SVELTE_RUNES = new Set([
  "$state",
  "$derived",
  "$effect",
  "$props",
  "$bindable",
  "$inspect",
  "$host",
]);

const SVELTEKIT_ROUTE_EXPORTS = new Set([
  "load",
  "actions",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "prerender",
  "ssr",
  "csr",
  "trailingSlash",
]);

const svelteKitByRoot = new Map<string, boolean>();

function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

export const SveltePlugin: AnalyzerPlugin = {
  name: "svelte-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    svelteKitByRoot.set(adapter.getConfig().rootDir, Boolean(allDeps["@sveltejs/kit"]));
    if (pkg) {
      if (SVELTE_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of SVELTE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("src/routes")) ||
      (await adapter.folderExists("src/App.svelte")) ||
      (await adapter.folderExists("App.svelte")) ||
      (await adapter.findFilesByGlob(["**/*.svelte"])).length > 0
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };
      svelteKitByRoot.set(adapter.getConfig().rootDir, Boolean(allDeps["@sveltejs/kit"]));

      const hasSvelteDep = SVELTE_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of SVELTE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // Safeguard installed Svelte ecosystem packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts invoking Svelte CLI / svelte-check
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("svelte-check") || scriptContent.includes("svelte-kit"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasSvelteDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Svelte configuration found but 'svelte' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Svelte SFC files (.svelte)
      if (normalized.endsWith(".svelte")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("svelte");
      }

      // 2. Svelte configuration files
      if (SVELTE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("svelte");
      }

      // 3. SvelteKit Route and App Hook files (+page.svelte, +page.ts, +server.ts, hooks.server.ts)
      if (normalized.includes("/src/routes/") || normalized.includes("/src/hooks.")) {
        if (
          basename.startsWith("+") ||
          basename.startsWith("hooks.server") ||
          basename.startsWith("hooks.client")
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("svelte");
          if (allDepsHasKit(adapter)) {
            adapter.markPackageAsUsed("@sveltejs/kit");
          }
        }
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SVELTE_CONFIG_FILES.includes(basename);
      const isSvelteKitRoute = normalized.includes("/src/routes/") && basename.startsWith("+");

      // 1. ESM Import Detection for Svelte Packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "svelte" ||
          source.startsWith("svelte/") ||
          source.startsWith("@sveltejs/")
        ) {
          adapter.markPackageAsUsed(packageName(source));
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Svelte 3/4 Lifecycle APIs
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (SVELTE_LIFECYCLE_APIS.has(node.callee.name)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("svelte");
        }
      }

      // 3. Svelte 5 Runes ($state, $derived, $effect, etc.)
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        SVELTE_RUNES.has(node.callee.name)
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("svelte");
      }

      // 4. Svelte Stores ($storeName auto-subscription)
      if (t.isIdentifier(node) && node.name.startsWith("$") && !SVELTE_RUNES.has(node.name)) {
        const storeName = node.name.slice(1);
        if (storeName) {
          adapter.markAsUsed(fileId, storeName);
        }
      }

      // 5. In Svelte Config Files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("svelte");
        }

        if (
          node?.type === "AssignmentExpression" &&
          (node as any).left?.type === "MemberExpression" &&
          (node as any).left?.object?.name === "module" &&
          (node as any).left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("svelte");
        }

        // Detect adapter: adapter() in svelte.config.js
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "adapter") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@sveltejs/kit");
        }
      }

      // 6. In SvelteKit Route files (+page.ts, +page.server.ts, +server.ts)
      if (isSvelteKitRoute) {
        if (node?.type === "ExportNamedDeclaration" && node.declaration) {
          const decl = node.declaration;
          if (
            t.isFunctionDeclaration(decl) &&
            decl.id &&
            SVELTEKIT_ROUTE_EXPORTS.has(decl.id.name)
          ) {
            adapter.markAsUsed(fileId, decl.id.name);
          } else if (t.isVariableDeclaration(decl)) {
            for (const d of decl.declarations) {
              if (t.isIdentifier(d.id) && SVELTEKIT_ROUTE_EXPORTS.has(d.id.name)) {
                adapter.markAsUsed(fileId, d.id.name);
              }
            }
          }
        }
      }
    },
  },
};

function allDepsHasKit(adapter: any): boolean {
  return svelteKitByRoot.get(adapter.getConfig().rootDir) ?? false;
}

export default SveltePlugin;
