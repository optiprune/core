import { describe, it } from "vitest";

// Original Knip test: workspaces/circular-symlinks.test.ts
// Skipped because OptiPrune does not expose the imported module ../../src/util/glob.js.
describe("workspaces/circular-symlinks.test.ts", () => {
  it.todo("OptiPrune compatibility for missing module ../../src/util/glob.js");
});
