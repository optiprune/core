import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/re-exports/enum-members-workspace");

test("Ignore re-exported enum members at a public workspace entry", async () => {
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});

test("Find unused re-exported enum members across workspaces when entry exports are included", async () => {
  const options = await createOptions({ cwd, isIncludeEntryExports: true });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    enumMembers: 2,
    processed: 3,
    total: 3,
  });
});
