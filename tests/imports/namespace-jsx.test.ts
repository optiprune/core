import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/imports/namespace-jsx');

test('Track namespace member access in JSX elements', async () => {
  const options = await createOptions({ cwd, isIncludeEntryExports: true });
  const { issues, counters } = await main(options);

  assert(issues.exports['components.tsx']['Layout.Unused']);
  assert(!issues.exports['components.tsx']?.['Layout.Container']);
  assert(!issues.exports['components.tsx']?.['Layout.Header']);
  assert(!issues.exports['components.tsx']?.['Layout.Footer']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 2,
    processed: 2,
    total: 2,
  });
});
