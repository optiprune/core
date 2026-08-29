import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/imports/import-meta-glob-alias");

test("Resolve import.meta.glob patterns with path aliases as entry files", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!("routes/admin/-guard.ts" in issues.files));
  assert(!("hooks/auth/-hook.ts" in issues.files));
  assert(!("lib/a/shared.ts" in issues.files));
  assert(!("lib/b/shared.ts" in issues.files));
  assert(!("pages/home/-page.ts" in issues.files));
  assert(!("pages/deep/nested/-page.ts" in issues.files));
  assert(!("admin/dashboard.ts" in issues.files));

  assert("routes/public/-guard.ts" in issues.files);
  assert("routes/admin/page.ts" in issues.files);
  assert("hooks/auth/helper.ts" in issues.files);
  assert("src/util.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 4,
    processed: 13,
    total: 13,
  });
});
