import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/tags-hints/tags-include');

test('Include or exclude tagged exports (include)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.exports['tags.ts']['NS.tagged']);
  assert(issues.exports['tags.ts']['NS.taggedToo']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 2,
    processed: 2,
    total: 2,
  });
});
