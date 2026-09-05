import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("stylelint plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("stylelint");
  });
});
