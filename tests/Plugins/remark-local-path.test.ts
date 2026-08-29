import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/remark-local-path");

test("Find dependencies with the Remark plugin (local plugin path)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.devDependencies["package.json"]["remark-cli"]);
  assert(issues.binaries["package.json"]["remark"]);
  assert.equal(issues.unlisted["package.json"]?.["./index.js"], undefined);
  assert.equal(issues.unresolved["package.json"]?.["./index.js"], undefined);
  assert.equal(issues.files["index.js"], undefined);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 1,
    devDependencies: 1,
    processed: 1,
    total: 1,
  });
});
