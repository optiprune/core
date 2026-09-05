import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("Tailwind compiler", () =>
  it("keeps directives parse-safe", () =>
    expect(edgeSpecifiers("@tailwind utilities;", "src/app.css")).toEqual([])));
