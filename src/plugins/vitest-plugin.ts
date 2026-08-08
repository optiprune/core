import { AnalyzerPlugin } from "../types.js";

const VITEST_CONFIG_FILES = [
  'vitest.config.ts',
  'vitest.config.js',
  'vitest.config.mjs',
  'vitest.config.cjs',
  'vitest.config.mts',
  'vitest.workspace.ts',
  'vitest.workspace.js',
  'vitest.workspace.json'
];

/**
 * Vitest Plugin: Erkennt Testdateien und stellt sicher, dass in TypeScript-Projekten
 * auch die notwendigen Transpiler (esbuild/tsx) als aktiv markiert werden.
 */
export const VitestPlugin: AnalyzerPlugin = {
  name: "vitest-plugin",
  version: "1.1.1",

  detect: async (adapter) => {
    const pkg = await adapter.readJson('package.json');
    
    // Check direct dependencies
    const hasVitestDep = !!(
      pkg?.devDependencies?.['vitest'] || 
      pkg?.dependencies?.['vitest']
    );
    if (hasVitestDep) return true;

    // Check configuration files in parallel
    const configChecks = await Promise.all(
      VITEST_CONFIG_FILES.map(file => adapter.readFile(file))
    );
    
    return configChecks.some(content => content !== null);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson('package.json');
      
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
        ...pkg?.optionalDependencies,
      };

      const hasVitestDep = !!allDeps['vitest'];

      // Parallel check for config existence
      const configChecks = await Promise.all(
        VITEST_CONFIG_FILES.map(async file => ({
          file,
          exists: (await adapter.readFile(file)) !== null
        }))
      );

      const hasConfigFile = configChecks.some(c => c.exists);

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

      const isTypeScript = !!(
        allDeps['typescript'] || 
        (await adapter.readFile('tsconfig.json')) !== null
      );

      if (isTypeScript) {
        // Mark common TS transpilers/utilities as used if present
        if (allDeps['esbuild']) adapter.markAsUsed('package.json', 'esbuild');
        if (allDeps['tsx']) adapter.markAsUsed('package.json', 'tsx');
        if (allDeps['@vitest/browser']) adapter.markAsUsed('package.json', '@vitest/browser');
      }
    },

    onFileStart: (fileId, adapter) => {
      // 1. Match test files by pattern anywhere in the project (e.g., src/math.test.ts, utils.spec.tsx)
      const isTestFile = /\.(test|spec)\.[jt]sx?$/.test(fileId);
      
      // 2. Match Vitest config and setup files by file name at end of path
      const isConfigFile = /[\\/]?vitest\.(config|setup|workspace)\.[a-z0-9]+$/i.test(fileId);

      if (isTestFile || isConfigFile) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default VitestPlugin;