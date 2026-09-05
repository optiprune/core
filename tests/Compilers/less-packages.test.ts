import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("Less packages", () =>
  it("tracks package imports", () =>
    expect(edgeSpecifiers('@import "lesshat/lesshat";', "src/style.less")).toContain(
      "lesshat/lesshat",
    )));
