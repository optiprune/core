import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/marko');

test('Find dependencies with the marko plugin', async () => {
  const options = await createOptions({ cwd });
  const { counters, issues } = await main(options);

  assert(issues.dependencies['package.json']['unused-library']);
  assert(issues.dependencies['package.json']['@orchard/unused-legacy-marko-tags']);
  assert(issues.dependencies['package.json']['@orchard/unused-marko-tags']);
  assert(!issues.dependencies['package.json']['@orchard/marko-tags']);
  assert(!issues.dependencies['package.json']['combined-marko-tags']);
  assert(!issues.dependencies['package.json']['legacy-marko-tags']);
  assert(issues.files['src/components/fruit-basket/seasonal-price-helper.ts']);
  assert.deepEqual(issues.unlisted, {});
  assert.deepEqual(issues.unresolved, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    dependencies: 3,
    processed: 11,
    total: 11,
  });
});
