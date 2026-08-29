import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/postcss-tailwindcss3');

test('Find dependencies with the PostCSS plugin (with @tailwindcss/postcss enabler)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.files['postcss.config.ts']);
  assert(!issues.devDependencies['package.json']?.['@tailwindcss/postcss']);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
