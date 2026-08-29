import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/qwik");
const cwdCustomDirs = resolve("fixtures/plugins/qwik-custom-dirs");

test("Find dependencies with the Qwik plugin", async () => {
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 8,
    total: 8,
  });
});

test("Find dependencies with the Qwik plugin (custom srcDir and routesDir[] with empty string)", async () => {
  const options = await createOptions({ cwd: cwdCustomDirs });
  const { issues, counters } = await main(options);

  assert(!("docs/extra-pages/index.tsx" in issues.files));
  assert(!("docs/pages/guide.mdx" in issues.files));
  assert(!("docs/components/mdx-note.tsx" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 10,
    total: 10,
  });
});
