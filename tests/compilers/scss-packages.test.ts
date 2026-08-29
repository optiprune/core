import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/compilers/scss-packages');

test('Built-in compiler for SCSS package imports (pkg:, scoped, tilde, tilde+scoped); tilde-less bare is treated as relative', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.dependencies['package.json']['foundation-sites']);

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    processed: 3,
    total: 3,
  });
});
