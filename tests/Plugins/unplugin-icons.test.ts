import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("unplugin-icons plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("unplugin-icons");
  });
});
