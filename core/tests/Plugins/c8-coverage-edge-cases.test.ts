import { beforeAll, describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/plugins/c8-coverage-edge-cases",
);

const c8Bin = path.join(fixtures, "node_modules/c8/bin/c8.js");

function resolveNpmCli(): string {
  // Finds the bundled npm CLI inside the current Node installation
  const npmPath = path.resolve(process.execPath, "../../lib/node_modules/npm/bin/npm-cli.js");
  if (existsSync(npmPath)) return npmPath;

  // Windows fallback path (node.exe sits in the same directory as node_modules)
  const winNpmPath = path.resolve(process.execPath, "../node_modules/npm/bin/npm-cli.js");
  if (existsSync(winNpmPath)) return winNpmPath;

  throw new Error("Could not locate npm-cli.js from current Node runtime");
}

beforeAll(async () => {
  // Automatically install if node_modules/c8 is missing (local dev or GitHub Actions)
  if (!existsSync(c8Bin)) {
    const npmCli = resolveNpmCli();
    execFileSync(process.execPath, [npmCli, "install", "--no-audit", "--no-fund"], {
      cwd: fixtures,
      stdio: "inherit",
    });
  }
}, 60000); // 60s timeout for first-time install in CI

async function analyzeWithCoverage(name: string) {
  const rootDir = path.join(fixtures, name);
  await fs.rm(path.join(rootDir, "coverage-final.json"), { force: true });
  await fs.rm(path.join(rootDir, "tmp"), { recursive: true, force: true });

  execFileSync(
    process.execPath,
    [c8Bin, "--reporter=json", "--all", "--report-dir=.", "node", "run.mjs"],
    {
      cwd: rootDir,
      stdio: "pipe",
    },
  );

  try {
    return await analyze({
      rootDir,
      entry: [],
      extensions: [".js", ".mjs", ".ts"],
      includeConventionalEntries: true,
      reportUnusedExports: true,
      reportUnusedExportsInUnreachableFiles: true,
      failOn: "none",
    });
  } finally {
    await fs.rm(path.join(rootDir, "coverage-final.json"), { force: true });
    await fs.rm(path.join(rootDir, "tmp"), { recursive: true, force: true });
    await fs.rm(path.join(rootDir, ".optiprune"), { recursive: true, force: true });
  }
}

function coverageFindings(report: Awaited<ReturnType<typeof analyze>>, rule: string) {
  return report.findings.filter((finding) => finding.rule === rule);
}

describe("c8 coverage edge-case fixtures", () => {
  it("honors ignore directives while reporting adjacent uncovered code", async () => {
    const report = await analyzeWithCoverage("fixture-1-ignore-directives");
    const uncovered = coverageFindings(report, "uncovered-runtime-statement");
    expect(uncovered.some((finding) => finding.location?.start.line === 9)).toBe(true);
    expect(
      uncovered.some((finding) =>
        [3, 6, 7, 8, 12, 13, 14].includes(finding.location?.start.line ?? -1),
      ),
    ).toBe(false);
  });

  it("reports uncovered inline branches and sibling lambdas from byte-offset coverage", async () => {
    const report = await analyzeWithCoverage("fixture-2-byte-offsets");
    expect(coverageFindings(report, "uncovered-runtime-branch").length).toBeGreaterThan(0);
  });

  it("uses --all coverage to report the untouched orphan source", async () => {
    const report = await analyzeWithCoverage("fixture-3-all-files");
    const orphanFindings = coverageFindings(report, "uncovered-runtime-statement").filter(
      (finding) => finding.file.endsWith("src/orphan.js"),
    );
    expect(orphanFindings.length).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.file.endsWith("interface.d.ts"))).toBe(false);
  });

  it("reports default-parameter and destructuring fallback ranges left untouched", async () => {
    const report = await analyzeWithCoverage("fixture-4-defaults-destructuring");
    const lines = coverageFindings(report, "uncovered-runtime-statement").map(
      (finding) => finding.location?.start.line,
    );
    expect(lines).toEqual(expect.arrayContaining([16, 17]));
    expect(
      coverageFindings(report, "uncovered-runtime-function").some(
        (finding) => finding.location?.start.line === 15,
      ),
    ).toBe(true);
  });

  it("merges master and worker coverage while reporting shared path C as dead", async () => {
    const report = await analyzeWithCoverage("fixture-5-workers");
    const sharedDead = coverageFindings(report, "uncovered-runtime-statement").filter((finding) =>
      finding.file.endsWith("shared.mjs"),
    );
    expect(sharedDead.some((finding) => finding.location?.start.line === 4)).toBe(true);
    expect(sharedDead.some((finding) => finding.location?.start.line === 2)).toBe(false);
    expect(sharedDead.some((finding) => finding.location?.start.line === 3)).toBe(false);
  });

  it("reports the inactive static branch, private method, and unused class-field arrow", async () => {
    const report = await analyzeWithCoverage("fixture-6-class-fields");
    const uncovered = coverageFindings(report, "uncovered-runtime-statement").filter((finding) =>
      finding.file.endsWith("fixture.mjs"),
    );
    expect(uncovered.length).toBeGreaterThan(0);
    expect(coverageFindings(report, "uncovered-runtime-branch").length).toBeGreaterThan(0);
  });
});
