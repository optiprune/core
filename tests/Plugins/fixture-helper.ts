import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";
import { expect } from "vitest";
import { analyze } from "../../src/index.js";

type Assertion = {
  kind: "dependencies" | "devDependencies" | "exports" | "files" | "unlisted" | "unresolved";
  file: string;
  value: string | null;
};
type FixtureExpectation = { assertions: Assertion[]; tests: string[] };

export const fixturesRoot = path.resolve(process.cwd(), "tests/fixtures/plugins");
const expectations = JSON.parse(
  readFileSync(path.resolve(fixturesRoot, "_metadata/plugin-expectations.json"), "utf8"),
) as Record<string, FixtureExpectation>;

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
  const normalized = file.replace(/\\/g, "/");
  const basename = path.basename(normalized);
  if (normalized.includes("/.storybook/") || normalized.includes("/.config/")) return true;
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

function matchesPath(file: string, expected: string): boolean {
  return file === expected || file.endsWith(`/${expected}`);
}

function matchesFinding(finding: any, assertion: Assertion): boolean {
  const isDependencyAssertion = [
    "dependencies",
    "devDependencies",
    "unlisted",
    "unresolved",
  ].includes(assertion.kind);
  const directFileMatch = matchesPath(String(finding.file ?? ""), assertion.file);
  const importingFileMatch = (finding.evidence?.importingFiles ?? []).some((file: string) =>
    matchesPath(String(file), assertion.file),
  );
  if (!directFileMatch && !(isDependencyAssertion && importingFileMatch)) return false;
  if (assertion.kind === "files") return finding.rule === "unreachable-file";
  if (assertion.kind === "exports") {
    return (
      finding.rule === "unused-export" &&
      (assertion.value === null || String(finding.message ?? "").includes(assertion.value))
    );
  }
  if (!assertion.value) return false;
  const packageName = finding.evidence?.package;
  return (
    [
      "missing-dependency",
      "missing-dev-dependency",
      "unresolved-import",
      "unused-dependency",
      "unused-dev-dependency",
    ].includes(finding.rule) &&
    (packageName === assertion.value ||
      String(finding.message ?? "").includes(assertion.value) ||
      String(finding.evidence?.specifier ?? "").includes(assertion.value))
  );
}

function packageFromSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function hasPositiveDependencyUsage(report: any, assertion: Assertion): boolean {
  if (!["dependencies", "devDependencies"].includes(assertion.kind) || !assertion.value)
    return false;
  if ((report.usedPackages ?? []).includes(assertion.value)) return true;
  return (report.modules ?? []).some((module: any) =>
    (module.edges ?? []).some(
      (edge: any) => packageFromSpecifier(String(edge.specifier ?? "")) === assertion.value,
    ),
  );
}

export async function assertKnipFixture(rootDir: string): Promise<void> {
  const fixtureName = path.relative(fixturesRoot, rootDir).replace(/\\/g, "/");
  const fixtureExpectation = expectations[fixtureName];
  expect(fixtureExpectation, `Missing Knip expectation entry for ${fixtureName}`).toBeDefined();
  const expectedConfigFiles = fixtureExpectation.assertions
    .map((assertion) => assertion.file)
    .filter((file) => file !== "package.json" && existsSync(path.join(rootDir, file)));
  const configFiles = [
    ...new Set([
      ...collectFiles(rootDir)
        .filter(isConfigFile)
        .filter((file) => file !== "package.json"),
      ...expectedConfigFiles,
    ]),
  ].sort();
  const report = await analyze({
    rootDir,
    configFiles,
    includeConventionalEntries: true,
    reportUnusedExports: true,
    failOn: "none",
  });
  expect(
    report.findings.filter((finding) => finding.rule === "plugin-error"),
    `${fixtureName} produced a plugin error`,
  ).toEqual([]);
  for (const assertion of fixtureExpectation.assertions) {
    const matchesPositiveUsage = hasPositiveDependencyUsage(report, assertion);
    expect(
      matchesPositiveUsage || report.findings.some((finding) => matchesFinding(finding, assertion)),
      `${fixtureName}: expected ${assertion.kind} ${assertion.file} ${assertion.value ?? ""}`,
    ).toBe(true);
  }
}
