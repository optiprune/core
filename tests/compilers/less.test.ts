import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/compilers/less');

test('Built-in compiler for Less', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert('unused.less' in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 8,
    total: 8,
  });
});
