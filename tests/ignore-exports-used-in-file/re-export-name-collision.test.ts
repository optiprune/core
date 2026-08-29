import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/ignore-exports-used-in-file/re-export-name-collision");

test("Find unused exports respecting an ignoreExportsUsedInFile (re-export sharing an import name)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("helper" in issues.exports["barrel.ts"]);
  assert("compute" in issues.exports["math.ts"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 2,
    processed: 4,
    total: 4,
  });
});
