import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/jest4');

test('Find dependencies with the Jest plugin (inline babel-jest presets)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.devDependencies['package.json']?.['@babel/preset-env']);
  assert(!issues.devDependencies['package.json']?.['@babel/preset-typescript']);
  assert(!issues.devDependencies['package.json']?.['babel-plugin-react-compiler']);

  assert(issues.devDependencies['package.json']['jest']);

  assert.deepEqual(counters, {
    ...baseCounters,
    devDependencies: 1,
    processed: 1,
    total: 1,
  });
});
