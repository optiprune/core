import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/dependencies/duplicate-dependencies");

test("Report duplicate package.json entries (listed in both dependencies and devDependencies)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.devDependencies["package.json"]["typescript"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    devDependencies: 1,
    processed: 1,
    total: 1,
  });
});
