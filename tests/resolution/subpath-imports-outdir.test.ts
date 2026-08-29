import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/resolution/subpath-imports-outdir");

test('Resolve subpath imports to outDir with rootDir="."', async () => {
  const options = await createOptions({ cwd });
  const { counters, configurationHints } = await main(options);

  assert.equal(configurationHints.length, 1);
  assert.equal(configurationHints[0].type, "entry-redundant");

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});
