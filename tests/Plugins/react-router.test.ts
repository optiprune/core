import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

test('Find dependencies with the react-router plugin', async () => {
  const cwd = resolve('fixtures/plugins/react-router');
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 10,
    total: 10,
  });
});

test('Find dependencies with the react-router plugin [with absolute paths]', async () => {
  const cwd = resolve('fixtures/plugins/react-router-with-absolute-paths');
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 6,
    total: 6,
  });
});

test('Find dependencies with the react-router plugin [with custom server entry]', async () => {
  const cwd = resolve('fixtures/plugins/react-router-with-server-entry');
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 5,
    total: 5,
  });
});
