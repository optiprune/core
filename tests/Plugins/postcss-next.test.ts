import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("postcss-next plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("postcss-next");
  });
});
