import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("Less compiler", () =>
  it("resolves imports", () =>
    expect(edgeSpecifiers('@import (reference) "./theme.less";', "src/style.less")).toContain(
      "./theme.less",
    )));
