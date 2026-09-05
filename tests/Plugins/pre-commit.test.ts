import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("pre-commit plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("pre-commit");
  });
});
