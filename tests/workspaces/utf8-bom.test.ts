import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/workspaces/utf8-bom');

test('Discover workspace whose package.json starts with a UTF-8 BOM', async () => {
  const options = await createOptions({ cwd });
  await assert.doesNotReject(main(options));
  const { counters } = await main(options);
  assert.equal(counters.processed, 2);
});
