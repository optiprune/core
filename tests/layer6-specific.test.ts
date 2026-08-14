import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "layer6-tool-specific-dev-dependency");

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("Layer 6 tool-specific development dependency evidence", () => {
  it("does not let an ESLint script suppress an unused Prettier finding", async () => {
    await fs.mkdir(path.join(fixtureRoot, "src"), { recursive: true });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({
      name: "layer6-tool-specific-dev-dependency",
      private: true,
      scripts: { lint: "eslint ." },
      devDependencies: {
        eslint: "^9.0.0",
        prettier: "^3.0.0"
      }
    }, null, 2));
    await fs.writeFile(path.join(fixtureRoot, "src", "main.ts"), "export const value = 1;\n");

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/main.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.findings.some((finding) => finding.rule === "prettier" && finding.evidence.type === "devDependency")).toBe(true);
    expect(report.findings.some((finding) => finding.rule === "eslint" && finding.evidence.type === "devDependency")).toBe(false);
  });
});
