import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/resolution/subpath-imports-to-dist');

test('Resolve `#`-subpath import pointing to outDir build artifact via source map', async () => {
  const options = await createOptions({ cwd });
  const { counters, issues } = await main(options);

  assert.deepEqual(issues.unresolved, {});
  assert.deepEqual(issues.files, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
