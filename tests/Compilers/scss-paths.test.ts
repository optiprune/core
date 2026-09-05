import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("SCSS paths", () =>
  it("tracks aliased stylesheet imports", () =>
    expect(edgeSpecifiers('@use "@theme/colors";', "src/style.scss")).toContain("@theme/colors")));
