import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/dependencies/path-shaped-binary");

test("Treat path-shaped script tokens as file references, report unlisted binaries", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.binaries["package.json"]["say-hello"]);
  assert(!issues.binaries["package.json"]["target/release/mytool"]);
  assert(!issues.binaries["package.json"]["/opt/example-tool"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    binaries: 1,
    processed: 0,
    total: 0,
  });
});
