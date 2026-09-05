import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("prettier-re-exports plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("prettier-re-exports");
  });
});
