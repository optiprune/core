import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "../fixtures/functions/ts-reference-directives");

describe("TypeScript reference directives", () => {
  it("keeps a referenced TypeScript file reachable through a triple-slash path reference", async () => {
    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(
      report.findings.some(
        (finding) => finding.rule === "unreachable-file" && finding.file.endsWith("src/ambient.ts"),
      ),
    ).toBe(false);

    const entryModule = report.modules.find((module) => module.path === "src/index.ts");
    expect(entryModule?.edges).toContainEqual(
      expect.objectContaining({
        specifier: "./ambient.ts",
        resolution: "resolved",
      }),
    );
  });
});
