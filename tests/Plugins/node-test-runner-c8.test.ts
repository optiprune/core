import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("node-test-runner-c8 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("node-test-runner-c8");
  });
});
