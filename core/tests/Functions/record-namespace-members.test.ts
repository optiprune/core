import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";

describe("namespace member records", () => {
  it("records complete namespace members and their JSDoc tags", () => {
    const module = parseModule(
      `/** @public */\nexport namespace API {\n  /** @ignore */\n  export const hidden = 1;\n  export function visible() {}\n}`,
      "api.ts",
    );

    expect(module.exports).toHaveLength(1);
    expect(module.exports[0]).toMatchObject({ name: "API", tags: ["public"] });
    expect(module.exports[0].members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "hidden", tags: ["ignore"] }),
        expect.objectContaining({ name: "visible", tags: [] }),
      ]),
    );
  });
});
