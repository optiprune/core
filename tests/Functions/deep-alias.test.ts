import { describe, it, expect } from 'vitest';
import { parseModule } from '../../src/parser.js';

describe('Deep Aliasing & Barrel Export Fix (Issue 3.3)', () => {
  it('should correctly capture local names for aliased re-exports', () => {
    const source = `
      export { LIVE_VALUE as AliasedLive } from '@repro/a';
    `;
    const module = parseModule(source, 'packages/b/index.ts');
    
    const reExport = module.exports.find(e => e.exportedAs === 'AliasedLive');
    expect(reExport).toBeDefined();
    expect(reExport?.name).toBe('LIVE_VALUE'); // This is the fix!
    expect(reExport?.isReExport).toBe(true);
    
    const edge = module.edges.find(e => e.rawSpecifier === '@repro/a');
    expect(edge).toBeDefined();
    expect(edge?.importedNames).toContain('LIVE_VALUE');
  });
});
