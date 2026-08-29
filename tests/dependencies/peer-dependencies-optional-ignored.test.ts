import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/dependencies/peer-dependencies-optional-ignored");

test("No issues for optional peerDependencies also listed in devDependencies", async () => {
  const options = await createOptions({ cwd });
  const { counters, configurationHints } = await main(options);

  assert.equal(configurationHints.length, 0);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
