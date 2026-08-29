import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/pm2');
const cwdEcosystem = resolve('fixtures/plugins/pm2-ecosystem');

test('Find entry files with the pm2 plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!('src/another.js' in issues.files));
  assert('src/unused.js' in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 3,
    total: 3,
  });
});

test('Find entry files with the pm2 plugin from ecosystem config', async () => {
  const options = await createOptions({ cwd: cwdEcosystem });
  const { issues, counters } = await main(options);

  assert(!('src/another.js' in issues.files));
  assert('src/unused.js' in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 3,
    total: 3,
  });
});
