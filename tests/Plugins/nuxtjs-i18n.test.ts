import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("nuxtjs-i18n plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("nuxtjs-i18n");
  });
});
