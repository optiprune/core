import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/resolution/custom-conditions");

test("Resolve an unbuilt workspace package through its source condition", async () => {
  const options = await createOptions({ cwd, isIncludeEntryExports: true });
  const { issues, counters } = await main(options);

  assert(issues.unresolved["packages/analyzer/src/analyzer.ts"]["#formats/../src/wave"]);
  assert.deepEqual(issues.files, {});
  assert.deepEqual(issues.exports, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    unresolved: 1,
    processed: 4,
    total: 4,
  });
});
