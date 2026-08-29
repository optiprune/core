import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/resolution/subpath-import-from-plugin');

test('Allows subpath-imports from plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.unlisted).length, 0);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});

test('Allows subpath-imports from plugin (production)', async () => {
  const options = await createOptions({ cwd, isProduction: true });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.unlisted).length, 0);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});

test('Allows subpath-imports from plugin (strict)', async () => {
  const options = await createOptions({ cwd, isStrict: true });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.unlisted).length, 0);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});
