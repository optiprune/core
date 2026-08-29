import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/unplugin-auto-import");

test("Resolve auto-imported composables with the unplugin-auto-import plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  // useCounter is auto-imported in a `.vue` script, useTheme in a plain `.ts` file → both resolved, not unused.
  assert(!("composables/useCounter.ts" in issues.files));
  assert(!("composables/useTheme.ts" in issues.files));
  // useUnused is registered but never referenced → still reported.
  assert("composables/useUnused.ts" in issues.files);

  assert(issues.dependencies["package.json"]["unplugin-auto-import"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    dependencies: 2,
    processed: 6,
    total: 6,
  });
});
