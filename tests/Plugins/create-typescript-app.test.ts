import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("create-typescript-app plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("create-typescript-app");
  });
});
