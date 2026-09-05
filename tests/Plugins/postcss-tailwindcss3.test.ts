import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("postcss-tailwindcss3 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("postcss-tailwindcss3");
  });
});
