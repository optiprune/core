import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("changesets plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("changesets");
  });
});
