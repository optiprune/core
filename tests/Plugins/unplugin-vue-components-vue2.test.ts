import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/unplugin-vue-components-vue2');

test('Resolve Vue 2 template auto-imports', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!('components/AppleCard.vue' in issues.files));
  assert('components/BananaCard.vue' in issues.files);
  assert(!('formatters/formatApple.ts' in issues.files));
  assert('formatters/formatBanana.ts' in issues.files);
  assert('formatters/setValue.ts' in issues.files);
  assert(issues.dependencies['package.json']['unplugin-auto-import']);
  assert(issues.dependencies['package.json']['unplugin-vue-components']);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 3,
    dependencies: 2,
    processed: 7,
    total: 7,
  });
});
