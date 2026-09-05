import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("karma3 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("karma3");
  });
});
