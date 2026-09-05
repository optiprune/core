import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("webpack-re-exports plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("webpack-re-exports");
  });
});
