import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("vite-plugin-pwa-nuxt plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("vite-plugin-pwa-nuxt");
  });
});
