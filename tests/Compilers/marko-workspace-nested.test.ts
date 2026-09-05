import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";
describe("nested Marko workspaces", () =>
  it("accepts Marko templates", () =>
    expect(
      parseModule("<div>Hello</div>", "packages/a/packages/b/src/index.marko").parseStatus,
    ).toBe("parsed")));
