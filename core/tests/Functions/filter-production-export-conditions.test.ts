import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { discoverPackageExportEntryPatterns } from "../../src/fs-utils.js";

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/functions/package-export-conditions",
);

describe("production package export conditions", () => {
  it("filters development conditions while retaining wildcard patterns", async () => {
    const all = await discoverPackageExportEntryPatterns(fixtureRoot);
    const production = await discoverPackageExportEntryPatterns(fixtureRoot, true);

    expect(all).toEqual(
      expect.arrayContaining([
        "src/development.ts",
        "src/index.ts",
        "src/development/*.ts",
        "src/features/*.ts",
      ]),
    );
    expect(production).toEqual(expect.arrayContaining(["src/index.ts", "src/features/*.ts"]));
    expect(production).not.toContain("src/development.ts");
    expect(production).not.toContain("src/development/*.ts");
  });
});
