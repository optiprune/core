import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/entry/package-entry-bare");

test("No package-entry hint for bare specifier in main when first segment is a listed dependency", async () => {
  const options = await createOptions({ cwd });
  const { configurationHints } = await main(options);

  assert.deepEqual(configurationHints, []);
});
