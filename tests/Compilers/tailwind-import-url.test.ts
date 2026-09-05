import { describe, expect, it } from "vitest";
import { edgeSpecifiers } from "./helpers.js";
describe("Tailwind URL imports", () =>
  it("tracks URL imports", () =>
    expect(edgeSpecifiers('@import url("./tailwind.css");', "src/app.css")).toContain(
      "./tailwind.css",
    )));
