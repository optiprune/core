import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("remark-local-path plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("remark-local-path");
  });
});
