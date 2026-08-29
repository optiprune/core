import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/unplugin-icons");

test("Handle virtual icons and iconify sets with the unplugin-icons plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  // `~icons/mdi/home` is a virtual import (counters verify 0 unresolved), and the icon set referenced only via that
  // virtual path is not reported as an unused dependency.
  assert(!("@iconify-json/mdi" in (issues.dependencies["package.json"] ?? {})));

  assert.deepEqual(counters, {
    ...baseCounters,
    dependencies: 1,
    processed: 1,
    total: 1,
  });
});
