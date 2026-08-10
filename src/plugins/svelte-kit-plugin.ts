import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SVELTEKIT_ROUTING_PATTERNS = [
  "+page.svelte",
  "+page.ts",
  "+page.js",
  "+page.server.ts",
  "+page.server.js",
  "+layout.svelte",
  "+layout.ts",
  "+layout.js",
  "+layout.server.ts",
  "+layout.server.js",
  "+error.svelte",
  "+server.ts",
  "+server.js",
  "hooks.server.ts",
  "hooks.server.js",
  "hooks.client.ts",
  "hooks.client.js",
  "hooks.ts",
  "hooks.js"
];

const SVELTEKIT_PROTECTED_EXPORTS = new Set([
  "load",
  "entries",
  "actions",
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
  "prerender",
  "ssr",
  "csr",
  "trailingSlash",
  "handle",
  "handleError",
  "handleFetch",
  "init"
]);

const SVELTEKIT_PACKAGES = [
  "@sveltejs/kit",
  "@sveltejs/adapter-auto",
  "@sveltejs/adapter-node",
  "@sveltejs/adapter-static",
  "@sveltejs/adapter-cloudflare",
  "@sveltejs/adapter-vercel",
  "@sveltejs/adapter-netlify",
  "@sveltejs/vite-plugin-svelte"
];

export const SvelteKitPlugin: AnalyzerPlugin = {
  name: "sveltekit-plugin",
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
          (dep) => dep === "@sveltejs/kit" || dep.startsWith("@sveltejs/adapter-")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && s.includes("svelte-kit")
          )
        ) {
          return true;
        }
      }
    }

    return await adapter.folderExists("src/routes");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasKitDep = Object.keys(allDeps).some(
        (p) => p === "@sveltejs/kit" || p.startsWith("@sveltejs/adapter-")
      );

      // 1. Safeguard all installed SvelteKit ecosystem packages in package.json
      if (hasKitDep) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "svelte" ||
            depName.startsWith("@sveltejs/")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Check for SvelteKit routes folder
      const hasRoutesFolder = await adapter.folderExists("src/routes");
      if (hasRoutesFolder) {
        adapter.markAsUsed("src/routes");
      }

      // 3. Track npm scripts invoking SvelteKit CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            scriptContent.includes("svelte-kit")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@sveltejs/kit");
          }
        }
      }

      // 4. Report missing dependency if routes directory exists without @sveltejs/kit
      if (hasRoutesFolder && !hasKitDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "SvelteKit routing directory found, but '@sveltejs/kit' is not listed in package.json.",
          evidence: { hasRoutesFolder }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect SvelteKit route files and hooks in src/routes or src/
      if (
        SVELTEKIT_ROUTING_PATTERNS.some((pattern) => basename === pattern) ||
        normalized.includes("/src/routes/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@sveltejs/kit");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Detect ESM imports for @sveltejs/kit
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "@sveltejs/kit" || source.startsWith("@sveltejs/kit/")) {
          adapter.markPackageAsUsed("@sveltejs/kit");
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Inspect route files and hooks for framework exports
      if (
        SVELTEKIT_ROUTING_PATTERNS.some((pattern) => basename === pattern) ||
        normalized.includes("/src/routes/")
      ) {
        if (t.isExportNamedDeclaration(node)) {
          // export function load() {} / export const actions = {}
          if (node.declaration) {
            const decl = node.declaration;
            if (
              t.isFunctionDeclaration(decl) &&
              decl.id &&
              SVELTEKIT_PROTECTED_EXPORTS.has(decl.id.name)
            ) {
              adapter.markAsUsed(fileId, decl.id.name);
            } else if (t.isVariableDeclaration(decl)) {
              for (const d of decl.declarations) {
                if (
                  t.isIdentifier(d.id) &&
                  SVELTEKIT_PROTECTED_EXPORTS.has(d.id.name)
                ) {
                  adapter.markAsUsed(fileId, d.id.name);
                }
              }
            }
          }

          // export { load, actions }
          if (Array.isArray(node.specifiers)) {
            for (const spec of node.specifiers) {
              const exportName = spec.exported?.name || spec.exported?.value;
              if (
                typeof exportName === "string" &&
                SVELTEKIT_PROTECTED_EXPORTS.has(exportName)
              ) {
                adapter.markAsUsed(fileId, exportName);
              }
            }
          }
        }

        // export default component
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default SvelteKitPlugin;