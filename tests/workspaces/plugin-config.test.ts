import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/workspaces/plugin-config");

test("Use root plugin config in workspaces", async () => {
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    total: 27,
    processed: 27,
  });
});

test("Use root plugin config in workspaces (strict production)", async () => {
  const options = await createOptions({ cwd, isStrict: true });
  const { issues, counters } = await main(options);

  assert("packages/frontend/components/component.js" in issues.files);
  assert("packages/frontend/vitest-include.ts" in issues.files);
  assert("packages/shared/components/component.js" in issues.files);
  assert("packages/shared/jest-setup.ts" in issues.files);

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 4,
    total: 9,
    processed: 9,
  });
});
