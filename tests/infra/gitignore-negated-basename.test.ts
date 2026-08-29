import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/infra/gitignore-negated-basename");

test("Unrelated gitignore negation does not un-ignore a sibling path", async () => {
  const options = await createOptions({ cwd });
  const { issues } = await main(options);

  assert.deepEqual(Object.keys(issues.files), ["lib/dist/helper.ts"]);
});
