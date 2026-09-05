import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("xo-0 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("xo-0");
  });
});
