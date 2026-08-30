import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("Less comments and imports do not create false file reachability", async () => {
  const { issues, counters } = await main(
    await createOptions({ cwd: resolve("fixtures/compilers/less") }),
  );
  assert("unused.less" in issues.files);
  assert.deepEqual(counters, { ...baseCounters, files: 1, processed: 8, total: 8 });
});
