import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("lefthook-v1 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("lefthook-v1");
  });
});
