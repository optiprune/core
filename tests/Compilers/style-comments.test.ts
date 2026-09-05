import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe(
  "stylesheet comments",
  () =>
    it("ignores commented imports", () =>
      expect(edgeSpecifiers('/* @import "unused-package"; */\n@import "./live.css";')).toEqual([
        "./live.css",
      ])),
  it("ignores line-comment imports", () =>
    expect(edgeSpecifiers('// @import "unused-package";')).toEqual([])),
);
