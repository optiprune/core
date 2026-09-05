import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";
describe("TSRX compiler", () =>
  it("keeps reactive TypeScript modules analyzable", () =>
    expect(parseModule("export const value = 1", "src/component.tsrx").parseStatus).not.toBe(
      "fallback",
    )));
