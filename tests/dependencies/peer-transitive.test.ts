import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("import resolved transitively via a declared peer is not flagged unlisted", async () => {
  const cwd = resolve("fixtures/dependencies/peer-transitive");
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.unlisted["packages/consumer/src/index.ts"]?.["transitive-peer"]);
  assert(issues.unlisted["packages/consumer/src/index.ts"]?.["uninstalled-peer"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 1,
    processed: 1,
    total: 1,
  });
});

test("strict mode still flags transitive-peer imports as unlisted", async () => {
  const cwd = resolve("fixtures/dependencies/peer-transitive");
  const options = await createOptions({ cwd, isStrict: true, isProduction: false });
  const { issues } = await main(options);

  assert(issues.unlisted["packages/consumer/src/index.ts"]?.["transitive-peer"]);
  assert(issues.unlisted["packages/consumer/src/index.ts"]?.["uninstalled-peer"]);
});
