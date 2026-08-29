import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/resolution/tsconfig-types-extends');

test('Treat extended tsconfig.json compilerOptions.types entries as type-only in the workspace', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.devDependencies['packages/script/package.json']?.['@types/chrome']);
  assert(!issues.unresolved['tsconfig.base.json']?.['chrome']);
  assert(!issues.unlisted['tsconfig.base.json']?.['chrome']);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
