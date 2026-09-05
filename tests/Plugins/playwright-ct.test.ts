import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("playwright-ct plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("playwright-ct");
  });
});
