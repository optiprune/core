import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

export const ViteSpecializedPlugin: AnalyzerPlugin = {
  name: "vite-specialized-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return !!(deps["electron-vite"] || deps["laravel-vite-plugin"]);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
      
      if (deps["electron-vite"]) {
        const hasConfig = (await adapter.readFile("electron.vite.config.ts")) !== null || 
                          (await adapter.readFile("electron.vite.config.js")) !== null;
        if (hasConfig) adapter.markAsUsed("electron.vite.config.ts");
      }
      
      if (deps["laravel-vite-plugin"]) {
        // Laravel Vite plugin often uses vite.config.js
        const viteConfig = await adapter.readFile("vite.config.js") || await adapter.readFile("vite.config.ts");
        if (viteConfig && viteConfig.includes("laravel-vite-plugin")) {
          adapter.markAsUsed("vite.config.js");
        }
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Detect electron-vite defineConfig
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "defineConfig") {
        if (fileId.includes("electron.vite.config")) {
          adapter.markAsUsed(fileId);
        }
      }
      
      // Detect laravel() plugin call in vite config
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "laravel") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default ViteSpecializedPlugin;
