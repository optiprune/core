import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("next-mixed-routers plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("next-mixed-routers");
  });
});
