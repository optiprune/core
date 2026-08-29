import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/nuxt');

test('Find dependencies with the Nuxt plugin without a config file', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.dependencies['package.json']['vue']);
  assert(issues.exports['utils/fn.ts']['unused']);

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    exports: 1,
    processed: 7,
    total: 7,
  });
});
