import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("Find dependencies with the starlight plugin", async () => {
  const cwd = resolve("fixtures/plugins/starlight/base");
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});

test("Find custom CSS with the starlight plugin", async () => {
  const cwd = resolve("fixtures/plugins/starlight/custom-css");
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    processed: 3,
    total: 3,
    files: 1,
  });
});
