import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import { join } from '../../src/util/path.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/workspaces/negated-reinclude');

test('Discover a workspace re-included after a negated pattern', async () => {
  const options = await createOptions({ cwd });
  const { includedWorkspaceDirs } = await main(options);

  assert(includedWorkspaceDirs.includes(join(cwd, 'packages/should-include')));
});
