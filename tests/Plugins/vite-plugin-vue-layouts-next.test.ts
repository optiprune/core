import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("vite-plugin-vue-layouts-next plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("vite-plugin-vue-layouts-next");
  });
});
