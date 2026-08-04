import { describe, it, expect } from 'vitest';
import { analyze } from '../src/index.ts';
import path from 'pathe';

describe('Complex Aliasing and Barrel Exports with Dynamic Imports', () => {
  const rootDir = path.resolve('/home/ubuntu/repro-complex');

  it('should NOT flag CORE_VALUE as unused across multiple packages and dynamic imports', async () => {
    const results = await analyze({
      rootDir,
      reportUnusedExports: true,
      verbose: true,
      includeConventionalEntries: true,
      layers: { skip3: false, skip4: false }
    });

    const reachableFiles = results.modules.map(m => m.path);
    console.log("Modules in report:", reachableFiles);
    console.log("All Findings Evidence:", JSON.stringify(results.findings.map(f => ({ rule: f.rule, file: f.file, evidence: f.evidence })), null, 2));
    
    // Find CORE_VALUE export in lib-a
    const coreValueFinding = results.findings.find(f => 
      f.rule === 'unused-export' && 
      f.file.includes('lib-a/src/core.ts') && 
      f.evidence.exportName === 'CORE_VALUE'
    );
    
    // Find ALIASED_VALUE export in lib-b
    const aliasedValueFinding = results.findings.find(f => 
      f.rule === 'unused-export' && 
      f.file.includes('lib-b/src/index.ts') && 
      f.evidence.exportName === 'ALIASED_VALUE'
    );

    // Find FINAL_VALUE export in lib-c
    const finalValueFinding = results.findings.find(f => 
      f.rule === 'unused-export' && 
      f.file.includes('lib-c/src/index.ts') && 
      f.evidence.exportName === 'FINAL_VALUE'
    );

    expect(coreValueFinding, 'CORE_VALUE in lib-a should be used').toBeUndefined();
    expect(aliasedValueFinding, 'ALIASED_VALUE in lib-b should be used').toBeUndefined();
    expect(finalValueFinding, 'FINAL_VALUE in lib-c should be used').toBeUndefined();

    if (results.findings.some(f => f.evidence.exportName === 'UNUSED_CORE')) {
       console.log("Found UNUSED_CORE in findings");
    } else {
       console.log("UNUSED_CORE NOT found in findings. All findings:", JSON.stringify(results.findings.filter(f => f.file.includes('core.ts')), null, 2));
    }

    // Verify that UNUSED_CORE is still flagged as unused
    const unusedCoreFinding = results.findings.find(f => 
      f.rule === 'unused-export' && 
      f.file.includes('lib-a/src/core.ts') && 
      f.evidence.exportName === 'UNUSED_CORE'
    );
    expect(unusedCoreFinding, 'UNUSED_CORE in lib-a should be unused').toBeDefined();
  });
});
