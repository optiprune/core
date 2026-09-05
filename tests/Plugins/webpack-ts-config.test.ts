import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("webpack-ts-config plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("webpack-ts-config");
  });
});
