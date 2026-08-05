import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

export const EslintPlugin: AnalyzerPlugin = {
  name: "eslint-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    const hasConfig = await adapter.readFile('eslint.config.js') || await adapter.readFile('.eslintrc.js');
    return !!(pkg?.devDependencies?.['eslint'] || hasConfig);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Markiere alle ESLint-Konfigurationsdateien als Einstiegspunkte
      if (fileId.includes('eslint.config.') || fileId.includes('.eslintrc')) {
        adapter.markAsUsed(fileId);
      }
      // Markiere benutzerdefinierte Regeln als genutzt
      if (fileId.includes('rules/') && fileId.endsWith('.ts')) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default EslintPlugin;