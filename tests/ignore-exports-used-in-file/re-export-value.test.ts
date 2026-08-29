import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/ignore-exports-used-in-file/re-export-value");

test("Find unused exports respecting an ignoreExportsUsedInFile (re-export from source)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("plum" in issues.exports["barrel.ts"]);
  assert("plum" in issues.exports["fruits.ts"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 2,
    processed: 3,
    total: 3,
  });
});
