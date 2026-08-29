import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/resolution/tsconfig-references-source-map");

test("Source map pairs are derived from referenced tsconfigs (e.g. tsconfig.build.json)", async () => {
  const options = await createOptions({ cwd });
  const { counters, issues } = await main(options);

  assert.deepEqual(issues.unresolved, {});
  assert.deepEqual(issues.files, {});

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
