import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/next-root-and-src');

test('Ignore src directory entry patterns when root pages or app directory exists', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert('src/app/page.tsx' in issues.files);
  assert('src/pages/legacy.ts' in issues.files);
  assert(!('pages/about.tsx' in issues.files));
  assert(!('src/middleware.ts' in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 2,
    processed: 7,
    total: 7,
  });
});
