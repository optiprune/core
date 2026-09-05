import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("webpack-cli plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("webpack-cli");
  });
});
