import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/plugins/docusaurus");

test("Find dependencies with the docusaurus plugin", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.unlisted["docusaurus.config.js"]["@docusaurus/theme-search-algolia"]);
  assert(issues.unlisted["docusaurus.config.js"]["@docusaurus/plugin-content-blog"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    unlisted: 2,
    processed: 13,
    total: 13,
  });
});
