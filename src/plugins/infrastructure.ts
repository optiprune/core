import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

// Vitest: Markiert Testdateien als Einstiegspunkte
export const VitestPlugin: AnalyzerPlugin = {
  name: "vitest-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    return !!(pkg?.devDependencies?.['vitest'] || await adapter.readFile('vitest.config.ts'));
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (fileId.endsWith('.test.ts') || fileId.endsWith('.spec.ts') || fileId.includes('vitest.config.')) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

// Husky & Tooling: Markiert Hooks und Configs
export const ToolingPlugin: AnalyzerPlugin = {
  name: "tooling-plugin",
  version: "1.0.0",
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      // Husky
      if (fileId.includes('.husky/')) adapter.markAsUsed(fileId);
      // Prettier & Oxlint
      if (fileId.includes('.prettierrc') || fileId.includes('oxlint')) adapter.markAsUsed(fileId);
    }
  }
};