import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/dependencies/aliased-packages-ancestor');

test('Prefer the alias declared in the closest workspace over the real package in an ancestor', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.deepEqual(issues.dependencies, {});
  assert.deepEqual(issues.devDependencies, {});
  assert.deepEqual(issues.unlisted, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
