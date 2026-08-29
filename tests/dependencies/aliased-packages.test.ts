import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/dependencies/aliased-packages');

test('Attribute imports of npm/jsr/catalog aliased packages to the declared alias', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.deepEqual(issues.unlisted, {});
  assert.deepEqual(issues.devDependencies, {});
  assert(issues.dependencies['package.json']['plotted-v2']);

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    processed: 1,
    total: 1,
  });
});

test('Report a production import of a dev-only aliased package in strict mode', async () => {
  const options = await createOptions({ cwd, isProduction: true, isStrict: true });
  const { issues } = await main(options);

  assert(issues.unlisted['index.ts']['tinted']);
  assert(!issues.unlisted['index.ts']?.['@org/tinted-lib']);
  assert(!issues.unlisted['index.ts']?.['styled']);
  assert(!issues.unlisted['index.ts']?.['themed']);
});
