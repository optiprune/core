import { describe, it } from "vitest";
import { assertPackagePlugin } from "./helpers.js";

describe("graphql-codegen-graphql-config2 plugin", () => {
  it("uses the package plugin rather than a numbered test-name plugin", () => {
    assertPackagePlugin("graphql-codegen-graphql-config2");
  });
});
