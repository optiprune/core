import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, test } from "vitest";
import { _load as load } from "../../src/util/loader.js";
import { resolve } from "../helpers/resolve.js";

describe("loader utility", () => {
  test("loads CommonJS modules", async () => {
    await assert.doesNotReject(load(join(resolve("tests/fixtures/load-cjs"), "index.js")));
  });
  test("loads ESM modules", async () => {
    await assert.doesNotReject(load(join(resolve("tests/fixtures/load-esm"), "index.js")));
  });
  test("loads ESM TypeScript modules", async () => {
    await assert.doesNotReject(load(join(resolve("tests/fixtures/load-esm-ts"), "index.ts")));
  });
  test("loads JSON5 files", async () => {
    const config = await load(join(resolve("tests/fixtures/load-json5"), "config.json5"));
    assert.equal(config.name, "test-config");
    assert.equal(config.plugins.length, 2);
    assert.equal(config.enabled, true);
  });
});
