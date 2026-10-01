import { describe, it, expect } from "vitest";
import { parseModule } from "../../src/parser.js";

describe("Parser Unit Tests", () => {
  it("should correctly parse exports and imports", async () => {
    const source = `
      export const a = 1;
      export type B = string;
      import { c } from './c';
      await import('./d');
    `;
    const module = parseModule(source, "test.ts");

    expect(module.exports.length).toBe(2);
    expect(module.exports[0].name).toBe("a");
    // In v1.2.0, type-only exports are tracked
    const typeExport = module.exports.find((e) => e.name === "B");
    expect(typeExport).toBeDefined();
    expect(typeExport?.isTypeOnly).toBe(true);

    expect(module.edges.length).toBe(2);
    expect(module.edges[0].kind).toBe("import");
    expect(module.edges[1].kind).toBe("dynamic-literal");
  });

  it("keeps triple-slash path references in the dependency graph", () => {
    const module = parseModule(
      `/// <reference path="./ambient.d.ts" />\nexport const value = 1;`,
      "src/index.ts",
    );
    expect(module.edges).toContainEqual(
      expect.objectContaining({
        rawSpecifier: "./ambient.d.ts",
        kind: "import",
        importedNames: ["*"],
        isTypeOnly: true,
      }),
    );
  });

  it("recognizes inline type-only import and export specifiers", () => {
    const imported = parseModule(`import { type Config } from "./config";`, "src/index.ts");
    expect(imported.edges).toContainEqual(
      expect.objectContaining({ rawSpecifier: "./config", isTypeOnly: true }),
    );

    const exported = parseModule(`export { type Config } from "./config";`, "src/index.ts");
    expect(exported.edges).toContainEqual(
      expect.objectContaining({ rawSpecifier: "./config", isTypeOnly: true }),
    );
    expect(exported.exports).toContainEqual(
      expect.objectContaining({ exportedAs: "Config", isTypeOnly: true }),
    );
  });
});
