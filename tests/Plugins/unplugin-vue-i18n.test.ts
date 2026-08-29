import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/unplugin-vue-i18n");

test("Handle the messages virtual module with the @intlify/unplugin-vue-i18n plugin", async () => {
  const options = await createOptions({ cwd });
  const { counters } = await main(options);

  // The `@intlify/unplugin-vue-i18n/messages` virtual module is not reported as an unlisted dependency (counters verify
  // 0 unlisted), and the base package is credited via the same import.
  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
