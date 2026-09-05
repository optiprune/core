import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("rspack plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("rspack");
  });
});
