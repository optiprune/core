import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/types/declare-module-augmentation");

test("Type used only in a declare module augmentation is not reported unused", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(!issues.types["events.ts"]?.["BaseEntity"]);
  assert(!issues.types["events.ts"]?.["EventEnvelope"]);
  assert(!issues.types["events.ts"]?.["AuditTrail"]);
  assert(!issues.types["events.ts"]?.["ArchiveMeta"]);

  assert.deepEqual(counters, {
    ...baseCounters,
    processed: 4,
    total: 4,
  });
});
