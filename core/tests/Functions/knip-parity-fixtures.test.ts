import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import {
  discoverPackageExportEntryPatterns,
  discoverPackageScriptTargets,
} from "../../src/fs-utils.js";
import { parseModule } from "../../src/parser.js";

const fixturesRoot = path.resolve("core/tests/fixtures/regressions");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

async function copyFixture(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `optiprune-regression-${name}-`));
  temporaryRoots.push(root);
  await fs.cp(path.join(fixturesRoot, name), root, { recursive: true });
  return root;
}

function hasFinding(
  report: Awaited<ReturnType<typeof analyze>>,
  rule: string,
  predicate: (finding: (typeof report.findings)[number]) => boolean,
): boolean {
  return report.findings.some((finding) => finding.rule === rule && predicate(finding));
}

describe("fixture regressions for the Knip parity implementation", () => {
  it("maps package exports and Node script targets from dist JSX/custom output to sources", async () => {
    const root = await copyFixture("source-mapping");
    const report = await analyze({
      rootDir: root,
      entry: [],
      extensions: [".ts", ".tsx", ".foo"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    expect(report.entryPoints).toEqual(expect.arrayContaining(["src/index.tsx", "src/custom.foo"]));
    for (const source of ["src/index.tsx", "src/custom.foo"]) {
      expect(
        hasFinding(report, "unreachable-file", (finding) => finding.file.endsWith(source)),
      ).toBe(false);
    }

    const targets = await discoverPackageScriptTargets(root, [".tsx", ".foo"]);
    expect(targets.find((target) => target.scriptName === "start")).toMatchObject({
      exists: true,
      relativePath: "src/cli.tsx",
    });
  });

  it("selects runtime workspace export fallbacks and resolves the source package", async () => {
    const root = await copyFixture("workspace-exports");
    const report = await analyze({
      rootDir: root,
      entry: ["packages/app/src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
    });

    expect(
      hasFinding(report, "unreachable-file", (finding) =>
        finding.file.endsWith("packages/ui/src/index.ts"),
      ),
    ).toBe(false);
    expect(
      hasFinding(
        report,
        "unused-dependency",
        (finding) => finding.evidence.package === "@fixture/ui",
      ),
    ).toBe(false);
  });

  it("removes test files from wildcard package exports in production mode", async () => {
    const root = await copyFixture("production-exports");
    const all = await discoverPackageExportEntryPatterns(root, false);
    const production = await discoverPackageExportEntryPatterns(root, true);

    expect(all).toEqual(expect.arrayContaining(["src/*.ts"]));
    expect(production).toEqual(expect.arrayContaining(["src/*.ts"]));
    expect(
      production.some((pattern) => pattern.includes(".test.") || pattern.includes("__tests__")),
    ).toBe(false);
  });

  it("preserves live nested namespace members while reporting the dead sibling", async () => {
    const root = await copyFixture("namespaces");
    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      reportUnusedExports: true,
    });

    const memberFindings = report.findings.filter(
      (finding) => finding.rule === "unused-member" && finding.file.endsWith("library.ts"),
    );
    expect(memberFindings.map((finding) => finding.evidence.memberName)).toEqual([
      "unused",
      "value",
    ]);
    expect(memberFindings.some((finding) => finding.evidence.memberName === "Size")).toBe(false);
    expect(memberFindings.some((finding) => finding.evidence.memberName === "Deep")).toBe(false);
  });

  it("protects tagged aliases through a barrel and emits hints for a used tagged member", async () => {
    const root = await copyFixture("tags");
    const report = await analyze({
      rootDir: root,
      entry: ["src/consumer.ts", "src/index.ts"],
      extensions: [".ts"],
      includeConventionalEntries: false,
      includeEntryExports: true,
      reportUnusedExports: true,
      tagHints: { lintignore: "ignore" },
    });

    expect(
      hasFinding(
        report,
        "unused-export",
        (finding) => finding.file.endsWith("module.ts") && finding.evidence.exportName === "apple",
      ),
    ).toBe(false);
    expect(report.hints?.map((hint) => hint.symbol)).toContain("Fruit.used");
    expect(report.hints?.map((hint) => hint.symbol)).not.toContain("Fruit.unused");
  });

  it("does not swallow the real Astro script after a self-closing JSON-LD tag", async () => {
    const root = await copyFixture("astro");
    const source = await fs.readFile(path.join(root, "src/page.astro"), "utf8");
    const parsed = parseModule(source, path.join(root, "src/page.astro"));
    expect(parsed.edges.map((edge) => edge.rawSpecifier)).toEqual(
      expect.arrayContaining(["./greet", "./analytics"]),
    );

    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts", ".astro"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });
    expect(
      hasFinding(report, "unreachable-file", (finding) => finding.file.endsWith("analytics.ts")),
    ).toBe(false);
  });

  it("resolves Jest short names and Vitest paths from the fixture configs", async () => {
    const root = await copyFixture("test-runners");
    const report = await analyze({
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts", ".js"],
      includeConventionalEntries: false,
      reportUnusedExports: false,
    });

    for (const dependency of [
      "jest-environment-jsdom",
      "jest-runner-groups",
      "jest-watch-typeahead",
      "vitest",
    ]) {
      expect(
        hasFinding(
          report,
          "unused-dev-dependency",
          (finding) => finding.evidence.package === dependency,
        ),
        dependency,
      ).toBe(false);
    }
    expect(report.entryPoints).toContain("packages/app/test/math.spec.ts");
    expect(
      hasFinding(report, "unreachable-file", (finding) =>
        finding.file.endsWith("packages/app/test/setup.ts"),
      ),
    ).toBe(false);
  });
});
