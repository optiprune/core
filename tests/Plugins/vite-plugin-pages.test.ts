import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/vite-plugin-pages');

test('Mark file-based routes as entries with the vite-plugin-pages plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  // Pages are discovered from the filesystem and reached via `~pages` → marked as entries, not unused.
  assert(!('src/pages/index.vue' in issues.files));
  assert(!('src/pages/about.vue' in issues.files));
  // A `.vue` outside the routes folder has no importer → still reported.
  assert('src/orphan.vue' in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    dependencies: 2,
    processed: 4,
    total: 4,
  });
});
