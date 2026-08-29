import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/imports/gitignored-generated");

test("Skip unresolved imports of gitignored generated files across extension aliases", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unresolved["index.ts"]["./missing.js"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    unresolved: 1,
    processed: 1,
    total: 1,
  });
});
