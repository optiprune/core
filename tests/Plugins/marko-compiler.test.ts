import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("marko-compiler plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("marko-compiler");
  });
});
