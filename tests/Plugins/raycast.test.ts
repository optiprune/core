import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/raycast");

test("Treat Raycast commands and tools as entries from package.json", async () => {
  const options = await createOptions({ cwd, isStrict: true });
  const { counters, issues } = await main(options);

  assert(!("src/search-bookmarks.tsx" in issues.files));
  assert(!("src/shared/load-bookmarks.ts" in issues.files));
  assert(!("src/tools/organize-tabs.ts" in issues.files));
  assert("src/unused.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    total: 4,
    processed: 4,
  });
});
