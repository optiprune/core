import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/workspaces/pnpm');

test('Find unused dependencies, exports and files in workspaces (loose)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.unlisted).length, 1);
  assert(issues.unlisted['apps/app-a/index.ts']['unlisted']);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 1,
    processed: 4,
    total: 4,
  });
});

test('Find no false unused workspace dependencies when run from workspace dir', async () => {
  const options = await createOptions({ cwd: resolve('fixtures/workspaces/pnpm/apps/app-a') });
  const { counters } = await main(options);

  assert.equal(counters.dependencies, 0);
});
