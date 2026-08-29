import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/vite-rolldown-babel");

test("Find babel plugins and presets via @rolldown/plugin-babel in a Vite config", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.files["some-custom-babel-plugin.js"]);
  assert(!issues.dependencies["package.json"]?.["babel-plugin-styled-components"]);
  assert(!issues.dependencies["package.json"]?.["@babel/preset-env"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 2,
    total: 2,
  });
});
