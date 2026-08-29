import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/storybook3');

test('Find dependencies with the Storybook plugin (vitest addon + coverage)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.devDependencies['package.json']?.['@vitest/coverage-v8']);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 0,
    processed: 2,
    total: 2,
  });
});
