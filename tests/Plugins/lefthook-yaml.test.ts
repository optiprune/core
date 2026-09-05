import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("lefthook-yaml plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("lefthook-yaml");
  });
});
