import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("astro-markdoc plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("astro-markdoc");
  });
});
