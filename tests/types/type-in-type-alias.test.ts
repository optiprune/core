import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/types/type-in-type-alias');

test('Flag types referenced only inside other exported types/interfaces', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.types['utils.ts']['Address']);
  assert(issues.types['utils.ts']['Contact']);

  assert(!issues.types['utils.ts']?.['UserInfo']);
  assert(!issues.types['utils.ts']?.['Employee']);

  assert.deepEqual(counters, {
    ...baseCounters,
    types: 2,
    processed: 2,
    total: 2,
  });
});
