import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/sveltekit-monorepo");

test("Resolve SvelteKit ./$types in a monorepo despite an ancestor tsconfig (#1778)", async () => {
  const options = await createOptions({ cwd });
  const { issues } = await main(options);

  assert.deepEqual(issues.unresolved, {});
});
