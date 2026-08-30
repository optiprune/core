import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("scss-url.test: compiler analysis completes without TODO", async () => {
  const { counters } = await main(await createOptions({ cwd: resolve("fixtures/compilers/scss") }));
  assert(counters.processed > 0);
  assert.equal(counters.processed, counters.total);
});
