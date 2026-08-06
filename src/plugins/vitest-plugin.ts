import { AnalyzerPlugin } from "../types.js";

/**
 * Vitest Plugin: Erkennt Testdateien und stellt sicher, dass in TypeScript-Projekten
 * auch die notwendigen Transpiler (esbuild/tsx) als aktiv markiert werden.
 */
export const VitestPlugin: AnalyzerPlugin = {
  name: "vitest-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    const hasVitest = !!(pkg?.devDependencies?.['vitest'] || pkg?.dependencies?.['vitest']);
    const hasConfig = !!(await adapter.readFile('vitest.config.ts') || await adapter.readFile('vitest.config.js'));
    return hasVitest || hasConfig;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      const isTypeScript = !!(pkg?.devDependencies?.['typescript'] || await adapter.readFile('tsconfig.json'));
      
      if (isTypeScript) {
        // Vitest benötigt in TS-Projekten oft esbuild oder tsx für die Transformation.
        // Wir markieren diese als 'used', damit sie nicht als ungenutzte Abhängigkeiten geflaggt werden.
        if (pkg?.devDependencies?.['esbuild']) adapter.markAsUsed('package.json', 'esbuild');
        if (pkg?.devDependencies?.['tsx']) adapter.markAsUsed('package.json', 'tsx');
        if (pkg?.devDependencies?.['@vitest/browser']) adapter.markAsUsed('package.json', '@vitest/browser');
      }
    },
    onFileStart: (fileId, adapter) => {
      // Markiert Testdateien und Konfigurationen als Einstiegspunkte
      const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(fileId);
      const isConfigFile = fileId.includes('vitest.config.') || fileId.includes('vitest.setup.');
      
      if (isTestFile || isConfigFile) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default VitestPlugin;
