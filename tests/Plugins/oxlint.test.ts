import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("oxlint plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("oxlint");
  });
});
