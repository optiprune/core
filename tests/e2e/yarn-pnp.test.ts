import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

test("E2E Yarn PnP workspace resolution discovers all workspace entries", async () => {
  const result = await main(await createOptions({ cwd: resolve("fixtures/yarn-pnp") }));
  assert.deepEqual(result.entryPoints.sort(), [
    "index.js",
    "packages/host-with-hidden-manifest/index.js",
    "packages/peer-package/index.js",
  ]);
  assert.deepEqual(result.summary, {
    filesDiscovered: 4,
    filesParsed: 4,
    filesRecovered: 0,
    filesFallback: 0,
    edges: 15,
    entryPoints: 3,
    stronglyConnectedComponents: 4,
    cycles: 0,
    findings: 2,
    errors: 0,
    warnings: 2,
  });
  assert.equal(result.findings.filter((finding) => finding.rule === "unused-dependency").length, 2);
});
