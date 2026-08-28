import { describe, it, expect } from 'vitest';
import { analyzeLayer6 } from '../../src/layer6.js';
import { AnalysisContext, ResolvedOptions } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/config-loader.js';
import fs from 'node:fs/promises';
import path from 'pathe';

describe('Layer 6: Enhanced Dependency Auditing', () => {
  const mockOptions: ResolvedOptions = {
    rootDir: '/tmp/layer6-test',
    entry: [],
    extensions: ['.ts'],
    ignore: [],
    reportUnusedExports: true,
    schemaEnums: {},
    failOn: 'none',
    json: false,
    includeConventionalEntries: false,
    pathAliases: new Map(),
    externalContracts: [],
    layers: {
      smtTimeoutMs: 1000,
      isolateMemoryLimitMb: 128,
      enableConcolicProof: false
    },
    rules: {}
  };

  it('retains only non-optional peers of a package that a plugin has actually marked as used', async () => {
    const rootDir = await fs.mkdtemp('/tmp/optiprune-required-peers-');
    try {
      await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
        dependencies: {
          framework: '1.0.0',
          'required-peer': '1.0.0',
          'optional-peer': '1.0.0',
        },
      }));
      await fs.mkdir(path.join(rootDir, 'node_modules', 'framework'), { recursive: true });
      await fs.writeFile(path.join(rootDir, 'node_modules', 'framework', 'package.json'), JSON.stringify({
        name: 'framework',
        peerDependencies: {
          'required-peer': '^1.0.0',
          'optional-peer': '^1.0.0',
        },
        peerDependenciesMeta: {
          'optional-peer': { optional: true },
        },
      }));

      const context: AnalysisContext = {
        options: {
          ...DEFAULT_CONFIG,
          rootDir,
          entry: [],
          ignore: [],
          pathAliases: new Map(),
          packageImports: new Map(),
          packageIgnoreDependencies: new Map(),
          layers: { ...DEFAULT_CONFIG.layers },
          rules: { ...DEFAULT_CONFIG.rules },
          plugins: { ...DEFAULT_CONFIG.plugins },
        },
        modules: new Map(),
        entryPoints: new Set(),
        reachable: new Set(),
        maybeReachable: new Set(),
        components: [],
        usedExports: new Set(),
        usedPackages: new Set(['framework']),
        enabledPlugins: new Set(['fixture-plugin']),
      } as AnalysisContext;

      const findings = await analyzeLayer6(context);
      expect(findings.some((finding) => finding.evidence.package === 'framework')).toBe(false);
      expect(findings.some((finding) => finding.evidence.package === 'required-peer')).toBe(false);
      expect(findings.some((finding) => finding.evidence.package === 'optional-peer')).toBe(true);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('should identify unused dependencies and devDependencies', async () => {
    const rootDir = mockOptions.rootDir;
    await fs.mkdir(rootDir, { recursive: true });
    
    const pkgJson = {
      dependencies: {
        'lodash': '^4.17.21',
        'unused-pkg': '1.0.0'
      },
      devDependencies: {
        'vitest': 'latest',
        'unused-dev-pkg': '1.0.0',
        '@types/lodash': 'latest'
      },
      scripts: {
        'test': 'vitest run'
      }
    };
    
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify(pkgJson));

    const context: AnalysisContext = {
      options: mockOptions,
      modules: new Map([
        ['/tmp/layer6-test/src/index.ts', {
          id: '/tmp/layer6-test/src/index.ts',
          edges: [
            { resolution: 'external', rawSpecifier: 'lodash', kind: 'import' }
          ]
        } as any]
      ]),
      entryPoints: new Set(['/tmp/layer6-test/src/index.ts']),
      reachable: new Set(['/tmp/layer6-test/src/index.ts']),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    const findings = await analyzeLayer6(context);

    // lodash is used (imported)
    expect(findings.find(f => f.evidence.package === 'lodash')).toBeUndefined();
    
    // vitest is used (in scripts)
    expect(findings.find(f => f.evidence.package === 'vitest')).toBeUndefined();
    
    // @types/lodash is used (because lodash is used)
    expect(findings.find(f => f.evidence.package === '@types/lodash')).toBeUndefined();

    // unused-pkg is unused
    const unusedPkg = findings.find(f => f.evidence.package === 'unused-pkg');
    expect(unusedPkg).toBeDefined();
    expect(unusedPkg?.severity).toBe('warning');

    // unused-dev-pkg is unused
    const unusedDevPkg = findings.find(f => f.evidence.package === 'unused-dev-pkg');
    expect(unusedDevPkg).toBeDefined();
    expect(unusedDevPkg?.severity).toBe('info');

    // Cleanup
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
