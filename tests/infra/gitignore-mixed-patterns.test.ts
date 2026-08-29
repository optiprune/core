import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/infra/gitignore-mixed-patterns");

test("Preserve the crawl root for mixed patterns", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters, configurationHints } = await main(options);

  assert.deepEqual(issues.files, {});
  assert.deepEqual(configurationHints, [
    { type: "project-redundant", identifier: "src/entry.ts", workspaceName: "." },
    { type: "project-empty", identifier: "ignored/*.ts", workspaceName: "." },
  ]);
  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 1,
    total: 1,
  });
});
