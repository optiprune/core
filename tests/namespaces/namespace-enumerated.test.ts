import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/namespaces/namespace-enumerated");

test("Consider namespace import members used when enumerated via Object.*", async () => {
  const options = await createOptions({ cwd, includedIssueTypes: ["nsExports"] });
  const { issues, counters } = await main(options);

  assert.equal(issues.nsExports["colors.ts"], undefined);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
