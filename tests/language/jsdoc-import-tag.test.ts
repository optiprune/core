import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/language/jsdoc-import-tag");

test("Track exported types referenced by JSDoc @import tags", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.types["types.ts"]["UnusedType"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    types: 1,
    processed: 3,
    total: 3,
  });
});
