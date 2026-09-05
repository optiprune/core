import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("eslint5 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("eslint5");
  });
});
