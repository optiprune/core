import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const fixtureRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/plugins",
);
const cases = [
  { name: "wireit", entry: ["src/index.ts"] },
  { name: "wrangler", entry: ["src/index.ts"] },
  {
    name: "wxt",
    entry: ["entrypoints/background.ts", "entrypoints/content.ts", "entrypoints/popup/main.ts"],
  },
  { name: "xo", entry: ["src/index.ts"] },
  { name: "yarn-berry", entry: [] },
  { name: "yorkie", entry: ["src/index.ts"] },
] as const;

describe("plugin fixtures through the complete analyze pipeline", () => {
  it.each(cases)("analyzes the $name project from disk", async ({ name, entry }) => {
    const report = await analyze({
      rootDir: path.join(fixtureRoot, name),
      entry: [...entry],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      failOn: "none",
    });

    expect(report.rootDir).toBe(path.join(fixtureRoot, name));
    expect(report.summary.filesDiscovered).toBeGreaterThanOrEqual(0);
    expect(report.summary.filesParsed).toBeGreaterThanOrEqual(0);
    expect(report.findings.some((finding) => finding.rule === "plugin-error")).toBe(false);

    for (const expectedEntry of entry) expect(report.entryPoints).toContain(expectedEntry);
  });
});
