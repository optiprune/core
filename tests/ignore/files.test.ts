import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/ignore/files");

test("Respect ignored files", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("apples/rooted.js" in issues.files);
  assert("unused.js" in issues.files);

  assert(issues.exports["apples/used.js"].unused);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 2,
    exports: 1,
    processed: 8,
    total: 12,
  });
});
