import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/xo-0');

test('Find dependencies with the xo plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unresolved['.xo-config.js']['eslint-plugin-unused-imports']);
  assert(issues.unlisted['xo.config.cjs']['my-shared-config']);
  assert(issues.unresolved['package.json']['eslint-plugin-eslint-comments']);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    unlisted: 1,
    unresolved: 2,
    total: 2,
  });
});
