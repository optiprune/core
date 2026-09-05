import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("SCSS compiler", () =>
  it("parses use and forward directives", () =>
    expect(edgeSpecifiers('@forward "./tokens";', "src/style.scss")).toContain("./tokens")));
