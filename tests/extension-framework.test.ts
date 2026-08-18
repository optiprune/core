import { describe, expect, it } from 'vitest';
import { ObjectMemberPlugin } from '../src/plugins/object-member-plugin.js';
import { VitePlugin } from '../src/plugins/vite-plugin.js';

const property = (name: string, value: any = { type: 'ObjectExpression', properties: [] }) => ({
  type: 'ObjectProperty', computed: false, key: { type: 'Identifier', name }, value,
});

describe('framework false-positive regressions', () => {
  it('does not report Storybook CSF object members such as args', async () => {
    const findings: any[] = [];
    const adapter = {
      isPublicExport: () => false,
      emitFinding: (finding: any) => findings.push(finding),
    } as any;
    ObjectMemberPlugin.lifecycle.onProjectInit?.(adapter);
    ObjectMemberPlugin.lifecycle.onASTNode?.({
      type: 'ExportNamedDeclaration',
      declaration: {
        type: 'VariableDeclaration',
        declarations: [{
          type: 'VariableDeclarator',
          id: { type: 'Identifier', name: 'Primary' },
          init: { type: 'ObjectExpression', properties: [property('args')] },
        }],
      },
    }, 'packages/ui/src/Button.stories.tsx', adapter);
    await ObjectMemberPlugin.lifecycle.onAnalysisComplete?.(adapter);
    expect(findings).toEqual([]);
  });

  it('adds vite.config.ts as an entry so config imports protect tool dependencies', async () => {
    const entries: string[] = [];
    const packages: string[] = [];
    const adapter = {
      readJson: async () => ({ devDependencies: { vite: '6.0.0', '@vitejs/plugin-react': '4.0.0' }, scripts: {} }),
      folderExists: async (file: string) => file === 'vite.config.ts',
      readFile: async () => "import react from '@vitejs/plugin-react'; export default { plugins: [react()] };",
      markAsUsed: () => {},
      markPackageAsUsed: (name: string) => packages.push(name),
      addEntryPatterns: (patterns: string[]) => entries.push(...patterns),
      emitFinding: () => {},
      getConfig: () => ({ rootDir: process.cwd() }),
    } as any;
    await VitePlugin.lifecycle.onProjectInit?.(adapter);
    expect(entries).toContain('vite.config.ts');
    expect(packages).toContain('vite');
  });
});