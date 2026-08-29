import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/panda-css");

test("Find dependencies with the Panda CSS plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unlisted["panda.config.ts"]["@pandacss/preset-panda"]);
  assert(issues.unlisted["panda.config.ts"]["@park-ui/panda-preset"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 2,
    processed: 1,
    total: 1,
  });
});
