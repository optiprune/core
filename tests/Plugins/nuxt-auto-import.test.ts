import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("nuxt-auto-import plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("nuxt-auto-import");
  });
});
