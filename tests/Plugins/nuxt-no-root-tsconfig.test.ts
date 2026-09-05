import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("nuxt-no-root-tsconfig plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("nuxt-no-root-tsconfig");
  });
});
