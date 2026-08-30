import { describe, it, expect } from "vitest";
import { analyze } from "../../src/index.js";
import path from "pathe";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("String Interpolation Dynamic Import", () => {
  const fixtureDir = path.join(__dirname, "../fixtures/interpolation-test");
  const rootDir = fixtureDir;

  it("should resolve dynamic import with string interpolation using Layer 4", async () => {
    const results = await analyze({
      rootDir,
      entryPoints: ["main.ts"],
      reportUnusedExports: true,
      verbose: true,
      layers: { skip3: false, skip4: false },
    });

    // Check if my-plugin.ts exports are NOT flagged as unused
    const unusedExport = results.findings.find(
      (f) => f.rule === "unused-export" && f.file.includes("my-plugin.ts"),
    );

    expect(unusedExport, "my-plugin.ts exports should be recognized as used").toBeUndefined();

    const unknownImport = results.findings.find(
      (f) => f.rule === "unknown-dynamic-import" && f.file.includes("main.ts"),
    );
    expect(unknownImport, "Should not have unknown-dynamic-import warning").toBeUndefined();
  });

  it("should handle data-flow with variables in dynamic imports (Nightmare Case)", async () => {
    const results = await analyze({
      rootDir,
      entryPoints: ["nightmare.ts"],
      reportUnusedExports: true,
      verbose: true,
      layers: { skip3: false, skip4: false },
    });

    // Check if my-plugin.ts is resolved despite the variable
    const unusedExport = results.findings.find(
      (f) => f.rule === "unused-export" && f.file.includes("my-plugin.ts"),
    );

    expect(unusedExport, "my-plugin.ts should be reached via variable").toBeUndefined();
  });

  it("should handle outer-scope variables in dynamic imports", async () => {
    const results = await analyze({
      rootDir,
      entryPoints: ["outer-scope.ts"],
      reportUnusedExports: true,
      verbose: true,
      layers: { skip3: false, skip4: false },
    });

    const unusedExport = results.findings.find(
      (f) => f.rule === "unused-export" && f.file.includes("my-plugin.ts"),
    );

    expect(unusedExport, "my-plugin.ts should be reached via outer-scope variable").toBeUndefined();
  });
});
