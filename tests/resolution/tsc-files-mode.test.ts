import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/resolution/tsc-files-mode");

test("Should use tsconfig files/include/exclude as project boundaries", async () => {
  const options = await createOptions({ cwd, isUseTscFiles: true });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.files).length, 0);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    processed: 4,
    total: 4,
  });
});

test("Should report unimported files as unused", async () => {
  const options = await createOptions({ cwd, isUseTscFiles: false });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.files).length, 3);
  assert("src/excluded.ts" in issues.files);
  assert("src/declare-module.ts" in issues.files);
  assert("src/declare-global.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    files: 3,
    processed: 5,
    total: 5,
  });
});
