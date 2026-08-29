import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/types/typeof-in-type-alias');

test('Flag values referenced only via typeof inside an exported type alias', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.exports['schema.ts']['PRESETS']);
  assert(issues.exports['schema.ts']['DAYS']);
  assert(issues.exports['schema.ts']['SHAPE']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 3,
    processed: 2,
    total: 2,
  });
});
