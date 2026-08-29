import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/quasar");

test("Find entries with the quasar plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("src/boot/forgotten.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 7,
    total: 7,
  });
});
