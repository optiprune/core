import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("simple-git-hooks plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("simple-git-hooks");
  });
});
