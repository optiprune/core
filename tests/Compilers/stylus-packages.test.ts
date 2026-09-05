import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("Stylus packages", () =>
  it("tracks package imports", () =>
    expect(edgeSpecifiers("@import 'nib'", "src/style.styl")).toContain("nib")));
