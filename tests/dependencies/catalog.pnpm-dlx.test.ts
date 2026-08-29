import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

test('Should track catalog entries referenced through pnpm dlx scripts', async () => {
  const cwd = resolve('fixtures/dependencies/catalog-pnpm-dlx');
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.deepEqual(Object.keys(issues.catalog['pnpm-workspace.yaml']), ['default.lodash', 'tools.unused']);
  assert.deepEqual(counters, {
    ...baseCounters,
    catalog: 2,
    processed: 0,
    total: 0,
  });
});
