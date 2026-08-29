import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vite-plugin-vue-layouts-next");

test("Mark layouts as entries with the vite-plugin-vue-layouts-next plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  // Layouts are resolved by name via a virtual module (no importer) → marked as entries, not unused.
  assert(!("src/layouts/default.vue" in issues.files));
  assert(!("src/layouts/admin.vue" in issues.files));
  // A `.vue` outside the layouts folder has no importer → still reported.
  assert("src/orphan.vue" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    dependencies: 2,
    processed: 3,
    total: 3,
  });
});
