import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/entry/package-entry-points-gitignored-workspace');

test('Exclude ignored workspace package entries after source mapping', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters, configurationHints } = await main(options);

  assert.deepEqual(Object.keys(issues.files), ['packages/app/src/orphan.ts']);
  assert.deepEqual(configurationHints, []);
  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 2,
    total: 2,
  });
});
