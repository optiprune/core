import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/rspack");

test("Find dependencies with the rspack plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.devDependencies["package.json"]["@swc/plugin-emotion"]);
  assert(!issues.devDependencies["package.json"]["swc-plugin-component-annotate"]);
  assert(issues.devDependencies["package.json"]["@rspack/core"]);

  assert(!("src/forms/login.ts" in issues.files));
  assert(!("src/forms/signup.ts" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    devDependencies: 1,
    processed: 4,
    total: 4,
  });
});
