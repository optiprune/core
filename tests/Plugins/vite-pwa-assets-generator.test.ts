import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("vite-pwa-assets-generator plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("vite-pwa-assets-generator");
  });
});
