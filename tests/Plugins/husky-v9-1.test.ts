import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("husky-v9-1 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("husky-v9-1");
  });
});
