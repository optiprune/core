import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/resolution/tsc-files-mode-svelte");

test("Auto-detect compiler-extension files within tsconfig include scope (--use-tsconfig-files)", async () => {
  const options = await createOptions({ cwd, isUseTscFiles: true });
  const { issues, counters } = await main(options);

  assert(issues.exports["src/helper.ts"]?.orphan);
  assert(!issues.exports["src/helper.ts"]?.used);
  assert("src/Orphan.svelte" in issues.files);
  assert(!("examples/Stray.svelte" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    exports: 1,
    files: 1,
    processed: 4,
    total: 4,
  });
});
