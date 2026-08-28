import { promises as fs } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "script-source-entry-regression");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("script output-to-source entry resolution", () => {
  it("maps a missing dist output back to an existing tsconfig source entry", async () => {
    await fs.mkdir(path.join(fixtureRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "tsconfig-output-source-entry",
      private: true,
      scripts: { start: "node dist/index.js" },
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { rootDir: "src", outDir: "dist" },
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "src", "index.ts"), "export const main = true;\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts", ".js"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.entryPoints).toContain("src/index.ts");
    expect(report.findings.some((finding) => finding.rule === "missing-script-target")).toBe(false);
  });
});
