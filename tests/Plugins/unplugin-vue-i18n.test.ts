import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("unplugin-vue-i18n plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("unplugin-vue-i18n");
  });
});
