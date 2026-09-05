import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("vitest4 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("vitest4");
  });
});
