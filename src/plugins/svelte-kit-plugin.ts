import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const SVELTEKIT_ROUTING_FILES = [
  "+page.svelte", "+page.ts", "+page.server.ts",
  "+layout.svelte", "+layout.ts", "+layout.server.ts",
  "+error.svelte", "+server.ts", "hooks.server.ts", "hooks.client.ts"
];

export const SvelteKitPlugin: AnalyzerPlugin = {
  name: "sveltekit-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg?.devDependencies?.["@sveltejs/kit"] || pkg?.dependencies?.["@sveltejs/kit"]) {
      return true;
    }
    // SvelteKit projects usually have a svelte.config.js that imports @sveltejs/kit
    const config = await adapter.readFile("svelte.config.js");
    if (config && config.includes("@sveltejs/kit")) return true;
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasKitDep = pkg ? !!(pkg.devDependencies?.["@sveltejs/kit"] || pkg.dependencies?.["@sveltejs/kit"]) : false;
      
      // Check for routing directory convention
      // (This is a bit heuristic, but SvelteKit projects always have src/routes)
      // In this environment, we can't easily list directories, but we can check common files
      const hasPage = await adapter.readFile("src/routes/+page.svelte");
      if (hasPage !== null && !hasKitDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "SvelteKit routing files found but '@sveltejs/kit' is not listed in package.json.",
          evidence: { hasPage: true }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      if (SVELTEKIT_ROUTING_FILES.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (node.type === "ExportNamedDeclaration" && node.declaration) {
        const decl = node.declaration;
        const protectedNames = ["load", "entries", "actions", "GET", "POST", "PUT", "DELETE", "PATCH", "prerender", "ssr", "csr"];
        
        if (decl.type === "FunctionDeclaration" && decl.id && protectedNames.includes(decl.id.name)) {
          adapter.markAsUsed(fileId, decl.id.name);
        }
        if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id.type === "Identifier" && protectedNames.includes(d.id.name)) {
              adapter.markAsUsed(fileId, d.id.name);
            }
          }
        }
      }
    }
  }
};

export default SvelteKitPlugin;
