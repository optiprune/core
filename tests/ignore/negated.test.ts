import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/ignore/negated");

test("Support negated ignore patterns", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert("src/modules/B/unusedFileB.js" in issues.files);
  assert(!("src/modules/A/unusedFileA.js" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    files: 1,
    processed: 2,
    total: 3,
  });
});
