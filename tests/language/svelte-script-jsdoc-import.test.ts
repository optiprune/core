import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/language/svelte-script-jsdoc-import');

test('Svelte compiler extracts type and dynamic imports from scripts', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!('src/LazyWidget.svelte' in issues.files));
  assert(!('src/types.ts' in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 4,
    total: 4,
  });
});
