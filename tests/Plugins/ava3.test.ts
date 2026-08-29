import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/ava3");

test("Find dependencies with the Ava plugin (3)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("test.js" in issues.files);
  assert("test.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 2,
    processed: 9,
    total: 9,
  });
});
