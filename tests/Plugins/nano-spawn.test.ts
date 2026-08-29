import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/nano-spawn');

test('Find binaries with the nano-spawn plugin', async () => {
  const options = await createOptions({ cwd });
  const { counters, issues } = await main(options);

  assert(!issues.binaries['main.js']?.phantomnano);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
