import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("remark-primary-unscoped plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("remark-primary-unscoped");
  });
});
