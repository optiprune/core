import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("storybook3 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("storybook3");
  });
});
