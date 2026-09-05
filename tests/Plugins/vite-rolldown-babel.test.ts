import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("vite-rolldown-babel plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("vite-rolldown-babel");
  });
});
