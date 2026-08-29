import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vite-plugin-pwa-nuxt");

test("Detect the injectManifest service worker from the @vite-pwa/nuxt pwa config", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!("service-worker/sw.ts" in issues.files));

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
