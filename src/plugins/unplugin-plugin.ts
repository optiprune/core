import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

export const UnpluginPlugin: AnalyzerPlugin = {
  name: "unplugin-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(deps).some(d => d.startsWith("unplugin-") || d.includes("/unplugin-"));
  },
  lifecycle: {
    onASTNode: (node, fileId, adapter) => {
      // Detect unplugin usage in config files (Vite, Webpack, Rollup, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const name = node.callee.name;
        if (name.startsWith("unplugin") || name.includes("AutoImport") || name.includes("Icons") || name.includes("Components")) {
          adapter.markAsUsed(fileId);
        }
      }
      
      // Detect unplugin imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("unplugin-") || source.includes("/unplugin-")) {
          adapter.markAsUsed(fileId);
          // Mark the unplugin package as used
          adapter.markAsUsed(source);
        }
      }
    }
  }
};

export default UnpluginPlugin;
