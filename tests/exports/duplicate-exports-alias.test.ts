import assert from "node:assert/strict";
import { test } from "vitest";
import { main } from "../../src/index.js";
import baseCounters from "../helpers/baseCounters.js";
import { createOptions } from "../helpers/create-options.js";
import { resolve } from "../helpers/resolve.js";

const cwd = resolve("fixtures/exports/duplicate-exports-alias");

test("Ignore duplicate exports with @alias (JSDoc)", async () => {
  const options = await createOptions({ cwd });
  const { issues, counters } = await main(options);

  assert(issues.duplicates["helpers.ts"]["isUntagged|isUntaggedAlias"]);
  assert(!issues.duplicates["helpers.ts"]["reExportedValue|reExportedAlias"]);
  assert(
    !issues.duplicates["specifier-default.ts"],
    "export { X }; export default X should not be duplicate",
  );

  assert.deepEqual(counters, {
    ...baseCounters,
    exports: 5,
    duplicates: 1,
    processed: 4,
    total: 4,
  });
});
