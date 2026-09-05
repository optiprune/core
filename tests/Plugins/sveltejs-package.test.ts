import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("sveltejs-package plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("sveltejs-package");
  });
});
