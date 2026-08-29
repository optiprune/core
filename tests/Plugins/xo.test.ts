import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/xo");

test("Find dependencies with the xo plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unlisted["xo.config.js"]["eslint-plugin-unused-imports"]);
  assert(issues.unlisted["xo.config.ts"]["my-shared-config"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    unlisted: 2,
    total: 2,
  });
});
