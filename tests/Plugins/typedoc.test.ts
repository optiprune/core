import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/typedoc');

test('Find dependencies with the typedoc plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.devDependencies['package.json']['typedoc']);
  assert(issues.unlisted['typedoc.json']['@appium/typedoc-plugin-appium']);
  assert(issues.unresolved['typedoc.json']['typedoc-plugin-expand-object-like-types']);
  assert(issues.unresolved['package.json']['typedoc-plugin-umami']);
  assert(issues.unresolved['tsconfig.json']['typedoc-plugin-zod']);
  assert(issues.unresolved['typedoc.json']['./dist/index.cjs']);
  assert(!('custom.js' in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    devDependencies: 1,
    unlisted: 1,
    unresolved: 4,
    processed: 1,
    total: 1,
  });
});
