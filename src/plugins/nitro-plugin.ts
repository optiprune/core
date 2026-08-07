import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

/**
 * Nitro Plugin: Schützt Dateien in server/api, server/routes und server/middleware.
 */
export const NitroPlugin: AnalyzerPlugin = {
  name: "nitro-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    if (pkg?.dependencies?.['nitropack'] || pkg?.devDependencies?.['nitropack']) {
      return true;
    }
    const nitroConfig = await adapter.readFile('nitro.config.ts') || await adapter.readFile('nitro.config.js');
    return !!nitroConfig;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const hasNitro = pkg ? !!(pkg.dependencies?.['nitropack'] || pkg.devDependencies?.['nitropack']) : false;
      
      const nitroConfigFiles = ['nitro.config.ts', 'nitro.config.js'];
      let hasConfigFile = false;
      for (const file of nitroConfigFiles) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasNitro) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Nitro configuration found but 'nitropack' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      // Markiert Nitro-spezifische Server-Dateien als Einstiegspunkte
      if (
        fileId.includes('server/api/') || 
        fileId.includes('server/routes/') || 
        fileId.includes('server/middleware/')
      ) {
        adapter.markAsUsed(fileId);
      }
      const fileName = path.basename(fileId);
      if (['nitro.config.ts', 'nitro.config.js'].includes(fileName)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Handle nitro.config.ts exports
      const fileName = path.basename(fileId);
      if (['nitro.config.ts', 'nitro.config.js'].includes(fileName)) {
        if (node.type === "ExportDefaultDeclaration") {
          adapter.markAsUsed(fileId, "default");
        }
      }
    }
  }
};

export default NitroPlugin;
