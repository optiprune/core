import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/ignore/members');

test('Respect ignored members, including string-to-regex, show config hints', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.enumMembers['enums.ts']['Direction.Down']);

  assert.deepEqual(counters, {
    ...baseCounters,
    enumMembers: 1,
    processed: 4,
    total: 4,
  });
});

test('Respect ignored members, including string-to-regex, show config hints (production)', async () => {
  const options = await createOptions({ cwd, isProduction: true });
  const { counters, configurationHints } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    enumMembers: 1,
    processed: 4,
    total: 4,
  });

  assert.deepEqual(configurationHints, []);
});
