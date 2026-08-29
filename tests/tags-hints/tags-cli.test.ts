import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import { join } from '../../src/util/path.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/tags-hints/tags-cli');

test('Include or exclude tagged exports (package.json)', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.exports['unimported.ts']['unimported']);
  assert(issues.exports['unimported.ts']['unimportedUntagged']);
  assert(issues.exports['tags.ts']['NS.UnusedUntagged']);
  assert(issues.exports['tags.ts']['NS.UnusedCustom']);
  assert(issues.exports['tags.ts']['NS.UnusedInternal']);
  assert(issues.exports['tags.ts']['NS.UnusedCustomAndInternal']);
  assert(issues.exports['tags.ts']['NS.MyCustomClass']);
  assert(issues.enumMembers['tags.ts']['MyEnum.UnusedUntagged']);
  assert(issues.enumMembers['tags.ts']['MyEnum.UnusedCustom']);
  assert(issues.enumMembers['tags.ts']['MyEnum.UnusedInternal']);
  assert(issues.enumMembers['tags.ts']['MyEnum.UnusedCustomAndInternal']);
  assert(issues.types['tags.ts']['NS.MyCustomEnum']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 7,
    types: 1,
    enumMembers: 4,
    processed: 3,
    total: 3,
  });
});

test('Include or exclude tagged exports (package.json/include)', async () => {
  const options = await createOptions({ cwd, tags: ['+custom'] });
  const { issues, counters } = await main(options);

  assert(issues.exports['unimported.ts']['unimported']);
  assert(issues.exports['tags.ts']['NS.UnusedCustom']);
  assert(issues.exports['tags.ts']['NS.UnusedCustomAndInternal']);
  assert(issues.exports['tags.ts']['NS.MyCustomClass']);
  assert(issues.types['tags.ts']['NS.MyCustomEnum']);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 4,
    types: 1,
    processed: 3,
    total: 3,
  });
});

test('Include or exclude tagged exports (package.json/exclude)', async () => {
  const options = await createOptions({ cwd, tags: ['-custom'] });
  const { issues, counters, tagHints } = await main(options);

  assert(issues.exports['tags.ts']['NS.UnusedUntagged']);
  assert(issues.exports['tags.ts']['NS.UnusedInternal']);
  assert(issues.enumMembers['tags.ts']['MyEnum.UnusedUntagged']);
  assert(issues.enumMembers['tags.ts']['MyEnum.UnusedInternal']);

  assert.deepEqual(
    tagHints,
    new Set([
      {
        type: 'tag',
        filePath: join(cwd, 'unimported.ts'),
        identifier: 'ignored',
        tagName: '@custom',
      },
    ])
  );

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 3,
    enumMembers: 2,
    processed: 3,
    total: 3,
  });
});
