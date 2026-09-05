import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("yorkie plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("yorkie");
  });
});
