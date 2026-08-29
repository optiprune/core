import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/types/enum-members-element-access-string-key');

test('Resolve named string-key access precisely and treat numeric-key access as a whole read', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.enumMembers['codes.ts']).length, 4);
  assert(issues.enumMembers['codes.ts']['NamedKey.unusedFirst']);
  assert(issues.enumMembers['codes.ts']['NamedKey.unusedSecond']);
  assert(issues.enumMembers['codes.ts']['NumberLikeKey.unused']);
  assert(issues.enumMembers['codes.ts']['NamespaceNamedKey.unused']);

  assert.deepEqual(counters, {
    ...baseCounters,
    enumMembers: 4,
    processed: 2,
    total: 2,
  });
});
