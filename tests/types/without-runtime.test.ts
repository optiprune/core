import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/types/without-runtime');

test('Report runtime imports as unlisted when only @types/X is installed', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unlisted['index.ts']?.orange);
  assert(!issues.unlisted['index.ts']?.banana);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 1,
    processed: 1,
    total: 1,
  });
});
