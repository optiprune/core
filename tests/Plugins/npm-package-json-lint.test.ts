import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("npm-package-json-lint plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("npm-package-json-lint");
  });
});
