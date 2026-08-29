import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/tsgo');
const nativeCwd = resolve('fixtures/plugins/typescript-native');

test('Find dependencies with the TypeScript plugin when using @typescript/native-preview', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.binaries['package.json']['tsgo']);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 1,
    devDependencies: 1,
    processed: 0,
    total: 0,
  });
});

test('Find dependencies with the TypeScript plugin when using stable TypeScript 7', async () => {
  const options = await createOptions({ cwd: nativeCwd });
  const { issues, counters } = await main(options);

  assert(issues.binaries['package.json']['tsc']);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 1,
    devDependencies: 1,
    processed: 0,
    total: 0,
  });
});
