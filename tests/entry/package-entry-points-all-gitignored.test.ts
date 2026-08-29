import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/entry/package-entry-points-all-gitignored");

test("Exclude package entry points in gitignored directories", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters, configurationHints } = await main(options);

  assert.deepEqual(Object.keys(issues.files), ["src/orphan.js"]);

  assert.deepEqual(configurationHints, []);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 1,
    total: 1,
  });
});
