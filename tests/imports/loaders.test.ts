import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/imports/loaders');

test('Inline dynamic import loaders consume only the default export of modules that have one', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.exports['pages/dashboard.ts'].unusedWidget);
  assert(issues.exports['pages/profile.ts'].unusedAvatar);
  assert(issues.exports['pages/settings.ts'].unusedToggle);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 3,
    processed: 7,
    total: 7,
  });
});
