import { describe, it, expect } from 'vitest';
import { PluginEngine } from '../../src/engine.js';
import { ReactPlugin } from '../../src/plugins/react-plugin.js';
import { NextjsPlugin } from '../../src/plugins/nextjs-plugin.js';
import { NuxtPlugin } from '../../src/plugins/nuxtjs-plugin.js';
import { parseModule } from '../../src/parser.js';
import { AnalysisContext, ResolvedOptions, ModuleRecord } from '../../src/types.js';

describe('Plugin Adapter & Framework Plugins', () => {
  const mockOptions: ResolvedOptions = {
    rootDir: '/test',
    entry: [],
    extensions: ['.ts', '.tsx', '.js', '.vue'],
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

  it('ReactPlugin should identify components and hooks', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('pathe');
    const rootDir = '/tmp/react-test';
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ dependencies: { 'react': '18.0.0' } }));

    const source = `
      export function MyComponent() {
        const [state, setState] = useState(0);
        return <div>{state}</div>;
      }
    `;
    const modules = new Map<string, ModuleRecord>();
    const filePath = path.join(rootDir, 'MyComponent.tsx');
    modules.set(filePath, parseModule(source, filePath));

    const context: AnalysisContext = {
      options: { ...mockOptions, rootDir },
      modules,
      entryPoints: new Set(),
      reachable: new Set(),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    const engine = new PluginEngine();
    engine.register(ReactPlugin);
    await engine.run(context);

    expect(context.reachable.has(filePath)).toBe(false);
    expect(context.usedExports.has(`${filePath}:MyComponent`)).toBe(true);

    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('NextjsPlugin should identify conventional entry points when enabled', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('pathe');
    const rootDir = '/tmp/next-test';
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ dependencies: { 'next': '13.0.0' } }));
    await fs.mkdir(path.join(rootDir, 'app'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'app/page.tsx'), 'export default function Page() {}');

    const modules = new Map<string, ModuleRecord>();
    const filePath = path.join(rootDir, 'app/page.tsx');
    modules.set(filePath, parseModule('export default function Page() {}', filePath));

    const context: AnalysisContext = {
      options: { ...mockOptions, rootDir },
      modules,
      entryPoints: new Set(),
      reachable: new Set(),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    const engine = new PluginEngine();
    engine.register(NextjsPlugin);
    await engine.run(context);

    expect(context.reachable.has(filePath)).toBe(true);
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('NuxtPlugin should identify directory conventions when enabled', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('pathe');
    const rootDir = '/tmp/nuxt-test';
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ dependencies: { 'nuxt': '3.0.0' } }));
    await fs.mkdir(path.join(rootDir, 'pages'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'pages/index.vue'), '<template><div>Nuxt page</div></template>');

    const modules = new Map<string, ModuleRecord>();
    const filePath = path.join(rootDir, 'pages/index.vue');
    modules.set(filePath, parseModule('// Nuxt page', filePath));

    const context: AnalysisContext = {
      options: { ...mockOptions, rootDir },
      modules,
      entryPoints: new Set(),
      reachable: new Set(),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    const engine = new PluginEngine();
    engine.register(NuxtPlugin);
    await engine.run(context);

    expect(context.reachable.has(filePath)).toBe(true);
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('should not enable a framework from package metadata alone', async () => {
    // Create a temporary package.json
    const fs = await import('node:fs/promises');
    const path = await import('pathe');
    const rootDir = '/tmp/optiprune-test-detection';
    await fs.mkdir(rootDir, { recursive: true });
    await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
      dependencies: { 'next': 'latest' }
    }));

    const options = { ...mockOptions, rootDir };
    const context: AnalysisContext = {
      options,
      modules: new Map(),
      entryPoints: new Set(),
      reachable: new Set(),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    const engine = new PluginEngine();
    engine.register(ReactPlugin);
    engine.register(NextjsPlugin);
    
    await engine.run(context);

    expect(ReactPlugin.enabled).toBe(false);
    expect(NextjsPlugin.enabled).toBe(false);

    // Cleanup
    await fs.rm(rootDir, { recursive: true, force: true });
  });
});
