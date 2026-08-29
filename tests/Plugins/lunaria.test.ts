import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

test('Find dependencies with the lunaria core scenario', async () => {
  const cwd = resolve('fixtures/plugins/lunaria/core');
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});

test('Find dependencies with the lunaria starlight integration scenario', async () => {
  const cwd = resolve('fixtures/plugins/lunaria/starlight');
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    processed: 2,
    total: 2,
  });
});
