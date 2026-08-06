import { AnalyzerPlugin } from "../types.js";

const SVELTEKIT_ROUTING_FILES = [
  "+page.svelte", "+page.ts", "+page.server.ts",
  "+layout.svelte", "+layout.ts", "+layout.server.ts",
  "+error.svelte", "+server.ts", "hooks.server.ts", "hooks.client.ts"
];

export const SvelteKitPlugin: AnalyzerPlugin = {
  name: "sveltekit-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["@sveltejs/kit"] || pkg?.dependencies?.["@sveltejs/kit"]);
  },
  lifecycle: {
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
