import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import { analyzeLayer6, buildLockfileGraph } from '../src/layer6.js';
import type { AnalysisContext } from '../src/types.js';

describe('Layer 6: Dependency & Boundary Engine', () => {
  it('should identify unused dependencies from package.json', async () => {
    const mockRootDir = path.resolve('/tmp/optiprune-test-layer6');
    if (!fs.existsSync(mockRootDir)) fs.mkdirSync(mockRootDir, { recursive: true });

    // Mock package.json
    fs.writeFileSync(path.join(mockRootDir, 'package.json'), JSON.stringify({
      dependencies: {
        'used-pkg': '1.0.0',
        'unused-pkg': '2.0.0'
      }
    }));

    // Mock package-lock.json
    fs.writeFileSync(path.join(mockRootDir, 'package-lock.json'), JSON.stringify({
      packages: {
        'node_modules/used-pkg': { version: '1.0.0' },
        'node_modules/unused-pkg': { version: '2.0.0' }
      }
    }));

    const mockContext: Partial<AnalysisContext> = {
      options: { rootDir: mockRootDir } as any,
      modules: new Map([
        ['file1.ts', {
          id: 'file1.ts',
          edges: [
            { resolution: 'external', rawSpecifier: 'used-pkg' }
          ]
        } as any]
      ]),
      reachable: new Set(['file1.ts']),
      maybeReachable: new Set()
    };

    const findings = await analyzeLayer6(mockContext as AnalysisContext);
    
    expect(findings).toContainEqual(expect.objectContaining({
      rule: 'unused-pkg',
      message: expect.stringContaining("Package 'unused-pkg' is declared as a dependency in package.json but never imported or used in scripts.")
    }));
    
    expect(findings).not.toContainEqual(expect.objectContaining({
      message: expect.stringContaining("Package 'used-pkg'")
    }));

    // Cleanup
    fs.rmSync(mockRootDir, { recursive: true, force: true });
  });

  it('should revoke Layer 5 protection for unreachable files', async () => {
    const mockContext: Partial<AnalysisContext> = {
      options: { rootDir: '.' } as any,
      modules: new Map([
        ['dead.ts', {
          id: 'dead.ts',
          relativePath: 'dead.ts',
          edges: [],
          exports: [
            { exportedAs: 'DeadController', isExternalContract: true, location: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } }
          ]
        } as any]
      ]),
      reachable: new Set(),
      maybeReachable: new Set()
    };

    const findings = await analyzeLayer6(mockContext as AnalysisContext);
    
    expect(findings).toContainEqual(expect.objectContaining({
      rule: 'protected-contract',
      message: expect.stringContaining("Revoked protection for unreferenced contract: DeadController")
    }));

    const deadModule = mockContext.modules?.get('dead.ts');
    expect(deadModule?.exports[0].isExternalContract).toBe(false);
  });
});
