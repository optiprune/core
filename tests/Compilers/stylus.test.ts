import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("Stylus compiler", () =>
  it("parses local imports", () =>
    expect(edgeSpecifiers("@import './variables'", "src/style.styl")).toContain("./variables")));
