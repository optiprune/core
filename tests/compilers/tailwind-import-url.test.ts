import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("Tailwind ignores commented URL imports and reports the missing plugin", async () => {
  const { issues, counters } = await main(
    await createOptions({
      cwd: resolve("fixtures/compilers/tailwind"),
      includedIssueTypes: ["unresolved", "cycles"],
    }),
  );
  assert.equal(issues.cycles?.length ?? 0, 0);
  assert.equal(Object.keys(issues.unresolved ?? {}).length, 1);
  assert.deepEqual(counters, { ...baseCounters, unresolved: 1, processed: 6, total: 6 });
});
