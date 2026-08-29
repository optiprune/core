import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/namespaces/shadow-false-negative");

test("Report exports shadowed by local bindings with ignoreExportsUsedInFile", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.exports["module.ts"]["serialize"]);
  assert(!issues.exports["module.ts"]?.["used"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    processed: 2,
    total: 2,
  });
});
