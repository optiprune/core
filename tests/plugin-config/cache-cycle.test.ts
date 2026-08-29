import { describe, it } from "vitest";

// Original Knip test: plugin-config/cache-cycle.test.ts
// Skipped because OptiPrune does not expose the imported module ../../src/WorkspaceWorker.js.
describe("plugin-config/cache-cycle.test.ts", () => {
  it.todo("OptiPrune compatibility for missing module ../../src/WorkspaceWorker.js");
});
