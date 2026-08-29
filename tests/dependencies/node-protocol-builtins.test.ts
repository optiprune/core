import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/dependencies/node-protocol-builtins');

test('Distinguish built-in specifiers from packages with built-in names', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.deepEqual(issues.dependencies, {});

  const unlisted = issues.unlisted['index.ts'] ?? {};
  assert(unlisted['unlisted-package']);
  assert(!Object.keys(unlisted).some(name => name.startsWith('node:')));

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 1,
    processed: 1,
    total: 1,
  });
});
