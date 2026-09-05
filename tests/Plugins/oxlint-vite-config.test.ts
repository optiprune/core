import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("oxlint-vite-config plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("oxlint-vite-config");
  });
});
