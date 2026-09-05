import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("relay2 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("relay2");
  });
});
