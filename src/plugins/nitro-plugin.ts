import { AnalyzerPlugin } from "../types.js";

/**
 * Nitro Plugin: Schützt Dateien in server/api, server/routes und server/middleware.
 */
export const NitroPlugin: AnalyzerPlugin = {
  name: "nitro-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.dependencies?.['nitropack'] || pkg?.devDependencies?.['nitropack']);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Markiert Nitro-spezifische Server-Dateien als Einstiegspunkte
      if (
        fileId.includes('server/api/') || 
        fileId.includes('server/routes/') || 
        fileId.includes('server/middleware/')
      ) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default NitroPlugin;
