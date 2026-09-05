import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("basic compilers", () =>
  it("parses standard imports", () =>
    expect(edgeSpecifiers('@import "./base.css";')).toContain("./base.css")));
