import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/namespaces/barrel-namespace-chain");

test("Barrel namespace chain: no false positives from OPAQUE, broad namespace refs, or tag hints", async () => {
  const options = await createOptions({ cwd, tags: ["-knipignore"] });
  const { issues, counters, tagHints } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 1,
    processed: 8,
    total: 8,
  });

  assert.equal(issues.exports["protocol.ts"]["lib.unusedExport"].symbol, "unusedExport");
  assert.equal(issues.exports["protocol.ts"]["lib.usedExport"], undefined);
  assert.equal(issues.exports["protocol.ts"]["lib.taggedExport"], undefined);

  assert.equal(tagHints.size, 0);
});
