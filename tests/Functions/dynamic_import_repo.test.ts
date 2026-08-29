import { describe, it, expect } from "vitest";
import { analyze } from "../../src/index.js";
import path from "pathe";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Dynamic Import Analysis Reproduction", () => {
  const rootDir = path.resolve(__dirname, "../..");

  it("should NOT flag AngularPlugin as unused when Layer 4 simulation is ENABLED", async () => {
    const results = await analyze({
      rootDir,
      entryPoints: [path.join(rootDir, "src/engine.ts")],
      reportUnusedExports: true,
      verbose: true,
      layers: { skip3: false, skip4: false },
    });

    const unusedAngular = results.findings.find(
      (f) => f.rule === "unused-export" && f.file.includes("angular-plugin.ts"),
    );

    expect(
      unusedAngular,
      "AngularPlugin should be recognized as used when Layer 4 is active",
    ).toBeUndefined();

    const unknownDynamic = results.findings.find(
      (f) => f.rule === "unknown-dynamic-import" && f.file.includes("engine.ts"),
    );

    expect(
      unknownDynamic,
      "Warning should be removed after successful Layer 4 resolution",
    ).toBeUndefined();
  });
});
