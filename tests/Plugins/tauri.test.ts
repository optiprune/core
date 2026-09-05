import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("tauri plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("tauri");
  });
});
