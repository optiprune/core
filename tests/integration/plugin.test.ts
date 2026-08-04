import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { analyze } from '../../src/index.js';
import fs from 'node:fs/promises';
import path from 'pathe';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.resolve(__dirname, '../../temp-plugin-test');

describe('Plugin Integration Tests', () => {
  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, 'index.ts'), `
      import { schema } from './schema';
      console.log(schema);
    `);
    await fs.writeFile(path.join(testDir, 'schema.ts'), `
      import { z } from 'zod';
      export const schema = z.object({ id: z.string() });
      export const unused = 1;
    `);
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should identify unused exports while respecting plugin-based usage', async () => {
    const report = await analyze({
      rootDir: testDir,
      entry: ['index.ts'],
      reportUnusedExports: true
    });

    const unusedExport = report.findings.find(f => f.rule === 'unused-export' && f.evidence.exportName === 'unused');
    const schemaExport = report.findings.find(f => f.rule === 'unused-export' && f.evidence.exportName === 'schema');

    expect(unusedExport).toBeDefined();
    // ZodPlugin hardening should protect 'schema'
    expect(schemaExport).toBeUndefined();
  });
});
