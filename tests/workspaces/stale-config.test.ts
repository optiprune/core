import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/workspaces/stale-config");

test("Report config hints for stale workspace configuration keys", async () => {
  const options = await createOptions({ cwd });
  const { configurationHints } = await main(options);

  assert.deepEqual(configurationHints, [
    { type: "workspaces", identifier: "packages/removed" },
    { type: "workspaces", identifier: "apps/*" },
  ]);
});
