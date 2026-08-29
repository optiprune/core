import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/entry/public-enum-members");

test("Keep internally unused enum members public when re-exported from an entry", async () => {
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});

test("Report public enum members when entry exports are included", async () => {
  const options = await createOptions({ cwd, isIncludeEntryExports: true });
  const { issues } = await main(options);

  assert(issues.enumMembers["mode.ts"]["Mode.external"]);
});

for (const issueType of ["nsExports", "nsTypes"] as const) {
  test(`Keep entry-exported enum members public with ${issueType} enabled`, async () => {
    const options = await createOptions({ cwd, includedIssueTypes: [issueType] });
    const { counters } = await main(options);

    assert.deepEqual(counters, {
      ...baseCounters,
      processed: 3,
      total: 3,
    });
  });
}
