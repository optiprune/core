import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("github-action plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("github-action");
  });
});
