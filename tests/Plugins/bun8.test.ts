import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/bun8');

test('Detect a bun test command chained after another bun command', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!('index.test.ts' in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});
