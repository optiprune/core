import { describe, expect, it } from "vitest";
import { parseModule } from "../../src/parser.js";

describe("TSX source locations", () => {
  it("maps non-ASCII TSX source locations to the correct line and column", () => {
    const module = parseModule(
      `const π = "präfix";\n\nexport const View = () => <section>✓</section>;`,
      "view.tsx",
    );
    const view = module.exports.find((entry) => entry.name === "View");

    expect(view?.location?.start).toMatchObject({ line: 3 });
    expect(view?.location?.start.column).toBe(11);
  });
});
