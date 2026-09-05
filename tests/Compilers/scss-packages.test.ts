import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("SCSS packages", () =>
  it("tracks module imports", () =>
    expect(edgeSpecifiers('@use "sass:color";', "src/style.scss")).toContain("sass:color")));
