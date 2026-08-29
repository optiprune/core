import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/remark-missing-placeholder');

test('Find dependencies with the Remark plugin (missing placeholder candidate)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.devDependencies['package.json']['remark-cli']);
  assert(issues.binaries['package.json']['remark']);
  assert(issues.unlisted['package.json']['remark-pkg-c']);
  assert.equal(issues.unresolved['package.json']?.['remark-pkg-c'], undefined);
  assert.equal(issues.unlisted['package.json']?.['pkg-c'], undefined);
  assert.equal(issues.unresolved['package.json']?.['pkg-c'], undefined);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 1,
    devDependencies: 1,
    unlisted: 1,
    processed: 0,
    total: 0,
  });
});
