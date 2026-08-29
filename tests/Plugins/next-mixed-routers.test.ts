import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/next-mixed-routers");

test("Support root pages directory combined with src/app directory", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("unused.ts" in issues.files);
  assert(!("pages/home.tsx" in issues.files));
  assert(!("src/app/page.tsx" in issues.files));
  assert(!("src/app/layout.tsx" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 5,
    total: 5,
  });
});
