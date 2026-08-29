import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/ignore/issues-workspaces');

test('Ignore issue types per workspace (paths relative to workspace root)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.exports['packages/apple/helpers.ts']?.['unusedApple']);
  assert(issues.exports['packages/banana/helpers.ts']?.['unusedBanana']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    processed: 4,
    total: 4,
  });
});
