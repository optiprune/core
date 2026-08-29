import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

test('Find unused exports respecting ignoreExportsUsedInFile: true', async () => {
  const cwd = resolve('fixtures/ignore-exports-used-in-file/basic');
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(Object.values(issues.exports).length, 1);
  assert.equal(issues.exports['imported.ts']['referencedNeverFunction'].symbol, 'referencedNeverFunction');
  assert.equal(issues.exports['imported.ts']['default'].symbol, 'default');
  assert.equal(issues.exports['imported.ts']['DeclaredThenExportedNamed'].symbol, 'DeclaredThenExportedNamed');
  assert.equal(issues.exports['imported.ts']['Paladin'].symbol, 'Paladin');

  assert.equal(Object.values(issues.types).length, 1);
  assert.equal(Object.values(issues.types['imported.ts']).length, 1);
  assert.equal(issues.types['imported.ts']['ReferencedNeverInterface'].symbol, 'ReferencedNeverInterface');

  assert.deepEqual(counters, {
    ...baseCounters,
    duplicates: 0,
    exports: 4,
    nsExports: 0,
    nsTypes: 0,
    processed: 10,
    total: 10,
    types: 1,
  });
});
