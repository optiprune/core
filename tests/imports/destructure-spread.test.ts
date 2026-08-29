import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/imports/destructure-spread');

test('Ignore namespace re-export by entry file', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.exports['fruits.js']['fruits.cherry']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    processed: 3,
    total: 3,
  });
});
