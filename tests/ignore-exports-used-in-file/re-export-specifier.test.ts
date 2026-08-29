import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/ignore-exports-used-in-file/re-export-specifier");

test("Find unused exports respecting an ignoreExportsUsedInFile (re-export specifier)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(issues.types["schemas.ts"]["Dead"].symbol, "Dead");
  assert.equal(issues.types["barrel.ts"]["Dead"].symbol, "Dead");

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
    types: 2,
  });
});
