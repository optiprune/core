import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("release-it plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("release-it");
  });
});
