import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/workspaces/malformed-manifest");

test("Skip workspace with invalid JSON in package.json (warn, continue)", async () => {
  const options = await createOptions({ cwd });
  await assert.doesNotReject(main(options));
});
