import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("github-actions plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("github-actions");
  });
});
