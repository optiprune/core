import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("react-native plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("react-native");
  });
});
