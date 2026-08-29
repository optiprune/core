import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/workspaces/workspace-sibling-undeclared');

test('Undeclared sibling import is unlisted in a published workspace, suppressed in a private one', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unlisted['packages/consumer/index.ts']['@scope/fruit']);
  assert(!issues.unlisted['packages/internal/index.ts']?.['@scope/fruit']);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 1,
    processed: 3,
    total: 3,
  });
});

test('strict mode flags undeclared sibling workspace regardless of visibility', async () => {
  const options = await createOptions({ cwd, isStrict: true });
  const { issues, counters } = await main(options);

  assert(issues.unlisted['packages/consumer/index.ts']['@scope/fruit']);
  assert(issues.unlisted['packages/internal/index.ts']?.['@scope/fruit']);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 2,
    processed: 3,
    total: 3,
  });
});
