import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("eleventy2 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("eleventy2");
  });
});
