import { describe, it, expect } from 'vitest';
import { analyzeLayer7 } from '../../src/layer7.js';
import { parseModule } from '../../src/parser.js';
import { AnalysisContext, ResolvedOptions, ModuleRecord } from '../../src/types.js';

describe('Layer 7: Non-Standard Entry & Implicit Binding Engine', () => {
  const mockOptions: ResolvedOptions = {
    rootDir: '/test',
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

  it('should detect DI injections via decorators', async () => {
    const providerSource = `
      @Injectable()
      export class AuthService {}
    `;
    const consumerSource = `
      @Controller()
      export class UserController {
        constructor(@Inject('AuthService') private auth: AuthService) {}
      }
    `;

    const modules = new Map<string, ModuleRecord>();
    modules.set('/test/AuthService.ts', parseModule(providerSource, '/test/AuthService.ts'));
    modules.set('/test/UserController.ts', parseModule(consumerSource, '/test/UserController.ts'));

    const context: AnalysisContext = {
      options: mockOptions,
      modules,
      entryPoints: new Set(['/test/UserController.ts']),
      reachable: new Set(['/test/UserController.ts']),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    await analyzeLayer7(context);

    // AuthService should now be reachable via DI injection
    expect(context.reachable.has('/test/AuthService.ts')).toBe(true);
    expect(context.usedExports.has('/test/AuthService.ts:AuthService')).toBe(true);
  });

  it('should detect orphaned event consumers', async () => {
    const consumerSource = `
      export class OrderSubscriber {
        @EventPattern('order.cancelled')
        handleOrderCancelled(data: any) {}
      }
    `;

    const modules = new Map<string, ModuleRecord>();
    modules.set('/test/OrderSubscriber.ts', parseModule(consumerSource, '/test/OrderSubscriber.ts'));

    const context: AnalysisContext = {
      options: mockOptions,
      modules,
      entryPoints: new Set(['/test/OrderSubscriber.ts']),
      reachable: new Set(['/test/OrderSubscriber.ts']),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    const findings = await analyzeLayer7(context);

    const orphanedFinding = findings.find(f => f.rule === 'protected-contract' && f.evidence.topic === 'order.cancelled');
    expect(orphanedFinding).toBeDefined();
    expect(orphanedFinding?.message).toContain('No producers found for topic \'order.cancelled\'');
  });

  it('should resolve dynamic imports with template literals', async () => {
    const source = `
      const lang = 'en';
      await import(\`./locales/\${lang}.json\`);
    `;
    
    const modules = new Map<string, ModuleRecord>();
    modules.set('/test/i18n.ts', parseModule(source, '/test/i18n.ts'));
    // Mock files in the filesystem
    modules.set('/test/locales/en.json', { id: '/test/locales/en.json', edges: [] } as any);
    modules.set('/test/locales/fr.json', { id: '/test/locales/fr.json', edges: [] } as any);

    const context: AnalysisContext = {
      options: mockOptions,
      modules,
      entryPoints: new Set(['/test/i18n.ts']),
      reachable: new Set(['/test/i18n.ts']),
      maybeReachable: new Set(),
      components: [],
      usedExports: new Set()
    };

    await analyzeLayer7(context);

    expect(context.reachable.has('/test/locales/en.json')).toBe(true);
    expect(context.reachable.has('/test/locales/fr.json')).toBe(true);
  });
});
