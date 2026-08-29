import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/vitest4');

test('Find dependencies with the Vitest plugin (4)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert('src/unused.test.ts' in issues.files);
  assert(issues.unlisted['vitest.config.ts']['custom-reporter-package']);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    unlisted: 1,
    processed: 5,
    total: 5,
  });
});
