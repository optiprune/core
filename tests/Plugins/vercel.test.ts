import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/vercel');
const workspacesCwd = resolve('fixtures/plugins/vercel-workspaces');

test('Find dependencies with the vercel plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.deepEqual(issues.files, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});

test('Find Vercel config files in workspace roots', async () => {
  const options = await createOptions({ cwd: workspacesCwd });
  const { issues, counters } = await main(options);

  assert.deepEqual(issues.files, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
