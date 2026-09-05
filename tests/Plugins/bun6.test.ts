import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("bun6 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("bun6");
  });
});
