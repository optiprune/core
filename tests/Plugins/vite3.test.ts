import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/vite3');

test('Find entry from Vite index.html module script', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!('src/App.tsx' in issues.files));
  assert('src/unused.ts' in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 2,
    total: 2,
  });
});
