import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugin-config/script-visitors-zx');

test('Find dependencies with custom script visitors (zx)', async () => {
  const options = await createOptions({ cwd });
  const { counters, issues } = await main(options);

  assert(!issues.binaries['zx-docs.mjs']?.config);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 4,
    total: 4,
  });
});
