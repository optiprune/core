import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/lefthook-yaml');

test('Find dependencies with the Lefthook plugin (lefthook.yaml)', async () => {
  const CI = process.env.CI;
  process.env.CI = '1';

  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 0,
    total: 0,
  });

  process.env.CI = CI;
});
