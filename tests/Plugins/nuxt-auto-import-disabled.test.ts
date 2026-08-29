import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/nuxt-auto-import-disabled');

test('Find dependencies and entries with auto-imports disabled', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert('composables/useTheme.ts' in issues.files);
  assert('components/StatusBadge.vue' in issues.files);

  assert(!issues.dependencies['package.json']['vue']);
  assert(issues.dependencies['package.json']['@vueuse/nuxt']);

  assert(issues.exports['utils/format.ts']['formatNumber']);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 2,
    dependencies: 1,
    exports: 1,
    processed: 7,
    total: 7,
  });
});
