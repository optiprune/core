import { promises as fs } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, "fixtures", "github-actions-member-usage");

async function writeFixture(relativePath: string, content: string): Promise<void> {
  const target = path.join(fixtureRoot, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

afterEach(async () => {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("GitHub Actions and object-member usage", () => {
  it("recognizes pnpm setup inside a local composite GitHub Action", async () => {
    await writeFixture("package.json", JSON.stringify({
      name: "composite-ci-setup",
      private: true,
      scripts: { check: "pnpm test" },
    }, null, 2));
    await writeFixture(".github/workflows/ci.yml", [
      "name: CI",
      "on: [push]",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: ./.github/actions/setup",
      "      - run: pnpm test",
    ].join("\n"));
    await writeFixture(".github/actions/setup/action.yml", [
      "name: setup",
      "runs:",
      "  using: composite",
      "  steps:",
      "    - uses: pnpm/action-setup@v3",
      "    - uses: actions/setup-node@v4",
      "      with:",
      "        node-version: 22",
    ].join("\n"));

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: [],
      extensions: [".ts"],
      includeConventionalEntries: false,
    });

    expect(report.findings.some((finding) => finding.rule === "missing-ci-setup")).toBe(false);
  });

  it("recognizes aliased, computed, nested, and spread object-member usage", async () => {
    await writeFixture("package.json", JSON.stringify({ name: "member-access-patterns", private: true }));
    await writeFixture("src/config.ts", "export const SITE = { title: 'T3', locale: 'en_US', twitter: 't3', openGraph: { image: { alt: 'logo' } } };\n");
    await writeFixture("src/app.ts", [
      "import { SITE } from './config';",
      "const alias = SITE;",
      "const copied = { ...SITE };",
      "export const output = `${alias['locale']}:${SITE.twitter}:${SITE.openGraph.image.alt}:${copied.title}`;",
    ].join("\n"));

    const report = await analyze({
      rootDir: fixtureRoot,
      entry: ["src/app.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
    });

    expect(report.findings.some((finding) => finding.rule === "unused-member")).toBe(false);
  });
});
