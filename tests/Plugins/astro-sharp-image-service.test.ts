import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("astro-sharp-image-service plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("astro-sharp-image-service");
  });
});
