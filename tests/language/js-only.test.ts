import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/language/js-only');

test('Find unused files and exports with only JS files', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.files).length, 1);
  assert('dangling.js' in issues.files);

  assert.equal(Object.values(issues.exports).length, 1);
  assert.equal(Object.values(issues.exports['my-namespace.js']).length, 2);
  assert.equal(issues.exports['my-namespace.js']['MyNamespace.x'].symbol, 'x');
  assert.equal(issues.exports['my-namespace.js']['MyNamespace.z'].symbol, 'z');

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    exports: 2,
    processed: 3,
    total: 3,
  });
});
