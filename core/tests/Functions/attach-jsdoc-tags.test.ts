import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";

describe("JSDoc tag attachment", () => {
  it("does not leak tags from an earlier namespace member", () => {
    const module = parseModule(
      `export namespace API { /** @ignore */ export const hidden = 1; }\n/** @public */ export const stable = 2;`,
      "tags.ts",
    );

    expect(module.exports.find((entry) => entry.name === "stable")?.tags).toEqual(["public"]);
  });
});
