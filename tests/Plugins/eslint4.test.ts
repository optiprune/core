import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("eslint4 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("eslint4");
  });
});
