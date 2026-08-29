import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/nuxtjs-i18n");

test("Recognize the vue-i18n config with the @nuxtjs/i18n plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!("i18n/i18n.config.ts" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
