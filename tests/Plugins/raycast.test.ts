import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("raycast plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("raycast");
  });
});
