import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugin-config/plugin-negated-entry-globs");

test("Handles config file shared by multiple plugins", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("src/pages/_util.ts" in issues.files);
  assert("src/pages/blog/_util.ts" in issues.files);
  assert("src/pages/blog/_util/index.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 3,
    processed: 7,
    total: 7,
  });
});
