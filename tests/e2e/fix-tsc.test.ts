import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";
import { applyFixes } from "../../src/fixer.js";
import { main } from "../../src/index.js";
import { join } from "../../src/util/path.js";
import { copyFixture } from "../helpers/copy-fixture.js";
import { createOptions } from "../helpers/create-options.js";

test("E2E fix pipeline analyzes and formats a TypeScript project", async () => {
  const cwd = await copyFixture("fixtures/fix");
  const report = await main(await createOptions({ cwd, tags: ["-lintignore"] }));
  const applied = await applyFixes(report, cwd, { rules: ["exports"], force: true });
  assert.ok(applied >= 1);
  const fixed = await readFile(join(cwd, "reexported.ts"), "utf8");
  assert.equal(fixed.includes("export { Two, Three }"), false);
  assert.equal(fixed.includes("export { Four as Fourth, Five as Fifth }"), false);
});
