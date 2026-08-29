import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/types/declaration-emit-inferred-router");

test("Keep types required by inferred declaration emit alive", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.types["src/handler.ts"]?.["HandlerOptions"]);
  assert(!issues.types["src/handler.ts"]?.["RecursiveUploadFile"]);
  assert(issues.types["src/handler.ts"]["UnusedHandlerOptions"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    types: 1,
    processed: 2,
    total: 2,
  });
});
