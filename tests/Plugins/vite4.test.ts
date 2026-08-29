import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vite4");

test("Find entry from Vite index.html with custom root", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!("app/main.ts" in issues.files));
  assert(!("app/component.ts" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 3,
    total: 3,
  });
});
