import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/compilers/tailwind');

test('Built-in compiler for Tailwind CSS', async () => {
  const options = await createOptions({ cwd, includedIssueTypes: ['unresolved', 'cycles'] });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.cycles).length, 0);

  assert.deepEqual(counters, {
    ...baseCounters,
    unresolved: 1,
    processed: 6,
    total: 6,
  });
});
