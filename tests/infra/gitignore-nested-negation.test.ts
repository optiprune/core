import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/infra/gitignore-nested-negation");

// Root .gitignore ignores a dot-prefixed directory. A nested `!*` inside that
// tree must not un-ignore sibling files (or files the nested rule would match).
test("A nested gitignore negation inside a gitignored dot-directory does not leak files", async () => {
  const options = await createOptions({ cwd });
  const { issues } = await main(options);

  assert.deepEqual(Object.keys(issues.files), ["src/orphan.ts"]);
});
