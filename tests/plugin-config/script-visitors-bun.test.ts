import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugin-config/script-visitors-bun');

test('Find dependencies with custom script visitors (bun)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.binaries['script.ts']['oh-my']);
  assert(!issues.binaries['script.ts']?.config);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
    binaries: 1,
  });
});
