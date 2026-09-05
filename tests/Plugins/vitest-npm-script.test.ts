import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("vitest-npm-script plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("vitest-npm-script");
  });
});
