import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/plugins/stryker');

test('Find dependencies with the Stryker plugin', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.dependencies['package.json']['@stryker-mutator/core']);
  assert(issues.unlisted['.stryker.conf.js']['@stryker-mutator/mocha-runner']);
  assert(issues.unlisted['.stryker.conf.js']['@stryker-mutator/typescript-checker']);
  assert(issues.unlisted['.stryker.conf.js']['@stryker-mutator/jasmine-framework']);
  assert(issues.unlisted['.stryker.conf.js']['@stryker-mutator/karma-runner']);
  assert(issues.unlisted['stryker.conf.cjs']['@stryker-mutator/mocha-runner']);
  assert(issues.unlisted['stryker.conf.cjs']['@stryker-mutator/typescript-checker']);
  assert(issues.unlisted['stryker.conf.cjs']['@stryker-mutator/jasmine-framework']);
  assert(issues.unlisted['stryker.conf.cjs']['@stryker-mutator/karma-runner']);
  assert(issues.unlisted['stryker.conf.json']['@stryker-mutator/karma-runner']);
  assert(issues.unlisted['stryker.conf.json']['@stryker-mutator/typescript-checker']);
  assert(issues.unlisted['stryker.conf.mjs']['@stryker-mutator/mocha-runner']);
  assert(issues.unlisted['stryker.conf.mjs']['@stryker-mutator/typescript-checker']);
  assert(issues.unlisted['stryker.conf.mjs']['@stryker-mutator/jasmine-framework']);
  assert(issues.unlisted['stryker.conf.mjs']['@stryker-mutator/karma-runner']);
  assert(issues.unlisted['stryker.custom.conf.ts']['@stryker-mutator/tap-runner']);
  assert(issues.unlisted['stryker.custom.conf.ts']['@stryker-mutator/typescript-checker']);
  assert(issues.binaries['package.json']['stryker']);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 1,
    dependencies: 1,
    unlisted: 16,
    processed: 4,
    total: 4,
  });
});
