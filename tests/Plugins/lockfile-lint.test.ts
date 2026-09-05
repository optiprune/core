import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("lockfile-lint plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("lockfile-lint");
  });
});
