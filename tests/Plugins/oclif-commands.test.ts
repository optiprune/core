import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("oclif-commands plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("oclif-commands");
  });
});
