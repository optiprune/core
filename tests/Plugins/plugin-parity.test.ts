import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

type Assertion = {
  kind: "dependencies" | "devDependencies" | "exports" | "files" | "unlisted" | "unresolved";
  file: string;
  value: string | null;
};
type FixtureExpectation = { assertions: Assertion[]; tests: string[] };

const fixtureRoot = path.resolve(process.cwd(), "tests/fixtures/plugins");
const expectations = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "tests/fixtures/plugins/_metadata/plugin-expectations.json"),
    "utf8",
  ),
) as Record<string, FixtureExpectation>;
const fixtureNames = Object.keys(expectations)
  .filter((name) => name !== "_template")
  .sort();

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
    basename === "package.json" ||
    basename === "angular.json" ||
    basename === "dangerfile.ts" ||
    basename.startsWith(".") ||
    basename.includes("config") ||
    basename.endsWith(".rc") ||
    basename.endsWith(".rc.js") ||
    basename.endsWith(".rc.json") ||
    basename.endsWith(".rc.yml") ||
    basename.endsWith(".rc.yaml")
  );
}

function findingPathMatches(file: string, expected: string): boolean {
  return file === expected || file.endsWith(`/${expected}`);
}

function positiveDependencyUsage(report: any, assertion: Assertion): boolean {
  if (!["dependencies", "devDependencies"].includes(assertion.kind) || !assertion.value)
    return false;
  if ((report.usedPackages ?? []).includes(assertion.value)) return true;
  const packageName = (specifier: string) =>
    specifier.startsWith("@")
      ? specifier.split("/").slice(0, 2).join("/")
      : specifier.split("/")[0];
  return (report.modules ?? []).some((module: any) =>
    (module.edges ?? []).some(
      (edge: any) => packageName(String(edge.specifier ?? "")) === assertion.value,
    ),
  );
}

function findingMatchesAssertion(finding: any, assertion: Assertion): boolean {
  const dependencyAssertion = [
    "dependencies",
    "devDependencies",
    "unlisted",
    "unresolved",
  ].includes(assertion.kind);
  const directMatch = findingPathMatches(String(finding.file ?? ""), assertion.file);
  const importingMatch = (finding.evidence?.importingFiles ?? []).some((file: string) =>
    findingPathMatches(String(file), assertion.file),
  );
  if (!directMatch && !(dependencyAssertion && importingMatch)) return false;
  if (assertion.kind === "files") return finding.rule === "unreachable-file";
  if (assertion.kind === "exports") {
    return (
      finding.rule === "unused-export" &&
      (assertion.value === null || String(finding.message ?? "").includes(assertion.value))
    );
  }
  if (!assertion.value) return false;
  const evidencePackage = finding.evidence?.package;
  return (
    (finding.rule === "missing-dependency" ||
      finding.rule === "missing-dev-dependency" ||
      finding.rule === "unresolved-import" ||
      finding.rule === "unused-dependency" ||
      finding.rule === "unused-dev-dependency") &&
    (evidencePackage === assertion.value ||
      String(finding.message ?? "").includes(assertion.value) ||
      String(finding.evidence?.specifier ?? "").includes(assertion.value))
  );
}

describe("Knip plugin parity", () => {
  it.each(fixtureNames)(
    "matches semantic expectations for %s",
    async (fixtureName) => {
      const rootDir = path.join(fixtureRoot, fixtureName);
      const configFiles = collectFiles(rootDir)
        .filter(isConfigFile)
        .filter((file) => file !== "package.json");
      const report = await analyze({
        rootDir,
        configFiles,
        includeConventionalEntries: true,
        reportUnusedExports: true,
        failOn: "none",
      });
      const fixtureExpectations = expectations[fixtureName].assertions;
      for (const assertion of fixtureExpectations) {
        expect(
          positiveDependencyUsage(report, assertion) ||
            report.findings.some((finding) => findingMatchesAssertion(finding, assertion)),
          `${fixtureName}: expected ${assertion.kind} ${assertion.file} ${assertion.value ?? ""}`,
        ).toBe(true);
      }
    },
    60000,
  );
});
