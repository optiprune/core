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
      const hasVitestDep = pkg ? !!(pkg.dependencies?.['vitest'] || pkg.devDependencies?.['vitest']) : false;
      
      const configFiles = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs'];
      let hasConfigFile = false;
      for (const file of configFiles) {
        if (await adapter.readFile(file) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasVitestDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Vitest configuration found but 'vitest' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }

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
      // Markiert Testdateien, Konfigurationen und Test-Ordner als Einstiegspunkte
      // Erkennt Dateien mit .test. oder .spec. Endungen
      const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(fileId);
      
      // Erkennt Dateien in typischen Test-Verzeichnissen (test, tests, __tests__)
      const isInTestFolder = /[\\/](test|tests|__tests__)[\\/]/.test(fileId);
      
      // Erkennt Vitest-Konfigurationsdateien
      const isConfigFile = fileId.includes('vitest.config.') || 
                          fileId.includes('vitest.setup.') || 
                          fileId.includes('vitest.workspace.');
      
      if (isTestFile || isInTestFolder || isConfigFile) {
        // Markiert die Datei als erreichbar/aktiv, um "unreachable-file" Warnungen zu verhindern
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default VitestPlugin;
