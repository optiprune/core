import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vite5");

test("Find entry from Vite index.html inline module script", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!("src/main.tsx" in issues.files));
  assert("src/unused.ts" in issues.files);
  assert("src/commented-out.ts" in issues.files);
  assert("src/decoy.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 3,
    processed: 4,
    total: 4,
  });
});
