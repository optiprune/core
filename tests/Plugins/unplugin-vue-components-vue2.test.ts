import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("unplugin-vue-components-vue2 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("unplugin-vue-components-vue2");
  });
});
