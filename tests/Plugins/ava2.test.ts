import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/ava2");

test("Find dependencies with the Ava plugin (2)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("__tests__/__helpers__/index.cjs" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 6,
    total: 6,
  });
});
