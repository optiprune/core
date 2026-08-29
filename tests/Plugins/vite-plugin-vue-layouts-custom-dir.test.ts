import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vite-plugin-vue-layouts-custom-dir");

test("Read the layouts dir from the vite-plugin-vue-layouts-next options in vite.config", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!("src/theme/default.vue" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    processed: 2,
    total: 2,
  });
});
