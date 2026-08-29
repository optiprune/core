import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vitest-regression");

test("Find entries and setup dependencies in Vitest configurations with arrays, SSR branches, and custom roots", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert.equal(Object.keys(issues.files).length, 0);
  assert.equal(Object.keys(issues.unresolved).length, 0);
  assert.equal(Object.keys(issues.unlisted).length, 0);
  assert.deepEqual(counters, {
    ...baseCounters,
    devDependencies: 1,
    processed: 5,
    total: 5,
  });
});
