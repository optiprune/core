import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

test('undeclared sibling import is unlisted in a published workspace, not in a private one', async () => {
  const cwd = resolve('fixtures/workspaces/workspace-tspaths-undeclared');
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.unlisted['projects/demo/src/index.ts']?.['@scope/fruit']);
  assert(issues.unlisted['projects/published-app/src/index.ts']['@scope/fruit']);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 1,
    processed: 3,
    total: 3,
  });
});

test('strict mode flags undeclared sibling workspace regardless of visibility', async () => {
  const cwd = resolve('fixtures/workspaces/workspace-tspaths-undeclared');
  const options = await createOptions({ cwd, isStrict: true });
  const { issues } = await main(options);

  assert(issues.unlisted['projects/demo/src/index.ts']?.['@scope/fruit']);
  assert(issues.unlisted['projects/published-app/src/index.ts']['@scope/fruit']);
});
