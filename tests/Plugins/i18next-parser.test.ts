import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("i18next-parser plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("i18next-parser");
  });
});
