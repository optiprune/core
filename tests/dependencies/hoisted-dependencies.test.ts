import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("Resolve hoisted binaries from a workspace package run as single project", async () => {
  const cwd = resolve("fixtures/dependencies/hoisted-dependencies/packages/foo");
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 0,
    binaries: 0,
    processed: 0,
    total: 0,
  });
});

test("Resolve hoisted peer dependencies from a workspace package run as single project", async () => {
  const cwd = resolve("fixtures/dependencies/hoisted-dependencies/packages/bar");
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
