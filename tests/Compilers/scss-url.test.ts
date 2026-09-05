import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("SCSS URLs", () =>
  it("tracks local assets", () =>
    expect(edgeSpecifiers('.hero { background: url("./hero.png"); }')).toContain("./hero.png")));
