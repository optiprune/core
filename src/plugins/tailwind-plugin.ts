import { AnalyzerPlugin } from "../types.js";

const TAILWIND_FILES = ["tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs"];

export const TailwindPlugin: AnalyzerPlugin = {
  name: "tailwind-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["tailwindcss"] || pkg?.dependencies?.["tailwindcss"]);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (TAILWIND_FILES.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (node.type === "ExportDefaultDeclaration") {
        adapter.markAsUsed(fileId, "default");
      }
    }
  }
};

export default TailwindPlugin;
