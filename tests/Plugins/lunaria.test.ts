import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("lunaria plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("lunaria");
  });
});
