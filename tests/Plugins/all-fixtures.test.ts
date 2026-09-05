import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures/plugins");
const fixtureNames = readdirSync(fixturesRoot)
  .filter((name) => name !== "_metadata")
  .filter((name) => statSync(path.join(fixturesRoot, name)).isDirectory())
  .sort();

const configBasenames = new Set([
  "angular.json",
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.ts",
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.json",
  "babel.config.mjs",
  "babel.config.ts",
  "dangerfile.ts",
  "jest.config.js",
  "jest.config.ts",
  "karma.conf.js",
  "knip.json",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "package.json",
  "playwright.config.ts",
  "rollup.config.js",
  "tsconfig.json",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.ts",
  "vitest.config.ts",
  "webpack.config.js",
  "wxt.config.ts",
]);

function collectFiles(rootDir: string, currentDir = rootDir): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const absolute = path.join(currentDir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(rootDir, absolute));
    else if (entry.isFile()) files.push(path.relative(rootDir, absolute).replace(/\\/g, "/"));
  }
  return files;
}

function isConfigFile(file: string): boolean {
  const basename = path.basename(file);
  return (
    configBasenames.has(basename) ||
    basename.startsWith(".eslintrc") ||
    basename.startsWith(".prettier") ||
    basename.startsWith(".stylelintrc") ||
    basename.startsWith(".babelrc") ||
    basename.startsWith(".markdownlint") ||
    basename.endsWith(".config.js") ||
    basename.endsWith(".config.cjs") ||
    basename.endsWith(".config.mjs") ||
    basename.endsWith(".config.ts") ||
    basename.endsWith(".config.json") ||
    basename.endsWith(".config.yml") ||
    basename.endsWith(".config.yaml") ||
    basename.endsWith(".rc") ||
    basename.endsWith(".rc.js") ||
    basename.endsWith(".rc.json") ||
    basename.endsWith(".rc.yml") ||
    basename.endsWith(".rc.yaml")
  );
}

describe("all Knip plugin fixtures", () => {
  it.each(fixtureNames)(
    "%s is processed through the OptiPrune plugin engine",
    async (fixtureName) => {
      const rootDir = path.join(fixturesRoot, fixtureName);
      const fixtureFiles = collectFiles(rootDir);
      const configFiles = fixtureFiles
        .filter(isConfigFile)
        .filter((file) => file !== "package.json");
      const report = await analyze({
        rootDir,
        configFiles,
        includeConventionalEntries: true,
        reportUnusedExports: false,
        failOn: "none",
      });

      expect(
        report.findings.filter((finding) => finding.rule === "plugin-error"),
        `${fixtureName} produced a plugin error`,
      ).toEqual([]);

      for (const configFile of configFiles) {
        expect(
          report.findings.some(
            (finding) =>
              finding.rule === "unreachable-file" && finding.file.endsWith(`/${configFile}`),
          ),
          `${fixtureName} left plugin config ${configFile} unreachable`,
        ).toBe(false);
      }
    },
  );
});
