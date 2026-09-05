import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("laravel-vite-plugin plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("laravel-vite-plugin");
  });
});
