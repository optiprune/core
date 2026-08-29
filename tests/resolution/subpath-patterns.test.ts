import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/resolution/subpath-patterns");

test("Allows subpath-patterns", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("src/internals/unused.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 5,
    total: 5,
  });
});

test("Allows subpath-patterns (production)", async () => {
  const options = await createOptions({ cwd, isProduction: true });
  const { issues, counters } = await main(options);

  assert("src/internals/unused.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 5,
    total: 5,
  });
});

test("Allows subpath-patterns (strict)", async () => {
  const options = await createOptions({ cwd, isStrict: true });
  const { issues, counters } = await main(options);

  assert("src/internals/unused.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 5,
    total: 5,
  });
});
