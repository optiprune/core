import assert from 'node:assert/strict';
import { test } from "vitest";
import { main } from '../../src/index.js';
import { createOptions } from '../helpers/create-options.js';
import { resolve } from '../helpers/resolve.js';

const cwd = resolve('fixtures/infra/gitignore');

test('Obey gitignore', async () => {
  const options = await createOptions({ cwd, gitignore: true });
  const { issues } = await main(options);

  assert.equal(Object.keys(issues.files).length, 0);
});
