import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("openapi-ts plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("openapi-ts");
  });
});
