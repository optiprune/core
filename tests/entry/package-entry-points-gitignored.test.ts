import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import { join } from '../../src/util/path.js';
import baseCounters from '../helpers/baseCounters.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/entry/package-entry-points-gitignored');

test('Exclude gitignored and null package entry points', async () => {
  const options = await createOptions({ cwd });
  const { issues, counters, configurationHints } = await main(options);

  assert('helper.js' in issues.files);
  assert('hidden.js' in issues.files);
  assert(!('dist/generated.js' in issues.files));
  assert(!('dist/extra.js' in issues.files));

  const filePath = join(cwd, 'package.json');
  assert.deepEqual(configurationHints, [
    { type: 'package-entry', identifier: './missing.js', workspaceName: '.', filePath },
  ]);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 2,
    processed: 3,
    total: 3,
  });
});
