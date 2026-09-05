import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";
describe("Marko workspaces", () =>
  it("recognizes Marko files", () =>
    expect(parseModule("<span/>", "packages/app/src/page.marko").id).toContain("page.marko")));
