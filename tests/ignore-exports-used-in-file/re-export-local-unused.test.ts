import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/ignore-exports-used-in-file/re-export-local-unused');

test('Find unused exports respecting an ignoreExportsUsedInFile (re-export of unreferenced import)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert('grape' in issues.exports['barrel.ts']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    processed: 3,
    total: 3,
  });
});
