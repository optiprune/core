import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("SCSS url() imports mark referenced assets as used", async () => {
  const { issues, counters } = await main(
    await createOptions({ cwd: resolve("fixtures/compilers/scss") }),
  );
  assert("unused.scss" in issues.files);
  assert("assets/unused.jpg" in issues.files);
  assert(!("assets/used.jpg" in issues.files));
  assert.deepEqual(counters, { ...baseCounters, files: 2, processed: 19, total: 19 });
});
