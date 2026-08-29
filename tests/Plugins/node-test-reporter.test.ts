import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/node-test-reporter');

test('Do not treat a node --test-reporter flag as a test runner invocation', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert('orphan.test.js' in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 2,
    total: 2,
  });
});
