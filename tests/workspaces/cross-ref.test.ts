import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/workspaces/cross-ref');

test('Root scripts referencing files in child workspace are not false positives', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!('scripts/generate.ts' in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
