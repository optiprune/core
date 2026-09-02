import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";

const fixturesRoot = fileURLToPath(new URL("../fixtures/dependencies", import.meta.url));

type Report = Awaited<ReturnType<typeof analyze>>;

function fixtureRoot(name: string): string {
  return fileURLToPath(new URL(`../fixtures/dependencies/${name}/`, import.meta.url));
}

async function analyzeFixture(
  name: string,
  options: Record<string, unknown> = {},
): Promise<Report> {
  return analyze({
    rootDir: fixtureRoot(name),
    entry: ["src/index.ts"],
    extensions: [".ts", ".tsx", ".d.ts"],
    includeConventionalEntries: false,
    reportUnusedExports: false,
    layers: { skip3: true, skip4: true, skipSmt: true },
    ...options,
  });
}

function hasFinding(report: Report, rule: string, packageName: string): boolean {
  return report.findings.some(
    (finding) => finding.rule === rule && finding.evidence?.package === packageName,
  );
}

describe("dependency attribution with isolated fixture roots", () => {
  it("resolves workspace alias resolution precedence", async () => {
    const report = await analyzeFixture("workspace-alias-resolution");
    expect(hasFinding(report, "unused-dependency", "@scope/shared")).toBe(false);
  });

  it("attributes aliased package dependencies", async () => {
    const report = await analyzeFixture("aliased-package-dependency");
    expect(hasFinding(report, "unused-dependency", "aliased-runtime")).toBe(false);
  });

  it("detects a basic unused dependency", async () => {
    const report = await analyzeFixture("basic-unused-dependency");
    expect(hasFinding(report, "unused-dependency", "unused-runtime")).toBe(true);
  });

  it("attributes Bun binary script usage", async () => {
    const report = await analyzeFixture("bun-binary-script");
    expect(hasFinding(report, "unused-dev-dependency", "bun-tool")).toBe(false);
  });

  it("tracks a package catalog entry used by an import", async () => {
    const report = await analyzeFixture("package-catalog-entry");
    expect(hasFinding(report, "unused-dependency", "catalog-runtime")).toBe(false);
  });

  it("handles an empty catalog entry without failing analysis", async () => {
    const report = await analyzeFixture("empty-catalog-entry");
    expect(hasFinding(report, "unused-dependency", "empty-catalog-runtime")).toBe(true);
  });

  it("tracks catalog dependencies referenced through pnpm dlx", async () => {
    const report = await analyzeFixture("catalog-pnpm-dlx");
    expect(hasFinding(report, "unused-dev-dependency", "catalog-cli")).toBe(false);
  });

  it("tracks PNPM catalog references", async () => {
    const report = await analyzeFixture("catalog-pnpm-reference");
    expect(hasFinding(report, "unused-dependency", "pnpm-catalog-runtime")).toBe(false);
  });

  it("tracks Yarn catalog references", async () => {
    const report = await analyzeFixture("catalog-yarn-reference");
    expect(hasFinding(report, "unused-dependency", "yarn-catalog-runtime")).toBe(false);
  });

  it("handles circular peer dependency manifests", async () => {
    const report = await analyzeFixture("circular-peer-dependencies");
    expect(hasFinding(report, "unused-peer-dependency", "peer-a")).toBe(false);
  });

  it("attributes wildcard workspace subpath imports", async () => {
    const report = await analyzeFixture("workspace-wildcard-subpath");
    expect(hasFinding(report, "unused-dependency", "@scope/shared")).toBe(false);
  });

  it("detects unused @types dependencies", async () => {
    const report = await analyzeFixture("unused-types-dependency");
    expect(hasFinding(report, "unused-dev-dependency", "@types/unused-runtime")).toBe(true);
  });

  it("inspects session dependency usage", async () => {
    const report = await analyzeFixture("session-dependency-usage");
    expect(hasFinding(report, "unused-dependency", "session-runtime")).toBe(false);
  });

  it("lists transitive required peers from the host manifest", async () => {
    const report = await analyzeFixture("transitive-peer-listing");
    expect(hasFinding(report, "unused-peer-dependency", "transitive-peer")).toBe(false);
  });

  it("filters path-shaped binary tokens as file references", async () => {
    const report = await analyzeFixture("path-shaped-binary");
    expect(hasFinding(report, "unused-dev-dependency", "path-shaped-tool")).toBe(true);
  });

  it("reports duplicate dependency sections", async () => {
    const report = await analyzeFixture("duplicate-dependency-sections");
    expect(hasFinding(report, "duplicate-dependency-section", "duplicated-runtime")).toBe(true);
  });

  it("resolves a hoisted workspace binary", async () => {
    const report = await analyzeFixture("hoisted-workspace-binary");
    expect(hasFinding(report, "unused-dev-dependency", "hoisted-cli-provider")).toBe(false);
  });

  it("places published declaration dependencies with their declaration graph", async () => {
    const report = await analyzeFixture("declaration-graph-placement");
    expect(hasFinding(report, "unused-dependency", "public-declaration-runtime")).toBe(false);
  });

  it("recognizes optional peer host references", async () => {
    const report = await analyzeFixture("optional-peer-host");
    expect(hasFinding(report, "unused-peer-dependency", "optional-host-runtime")).toBe(false);
  });

  it("retains transitive host peers", async () => {
    const report = await analyzeFixture("transitive-host-peer");
    expect(hasFinding(report, "unused-peer-dependency", "hosted-transitive-peer")).toBe(false);
  });

  it("ignores optional peers mirrored as devDependencies", async () => {
    const report = await analyzeFixture("dev-ignored-optional-peer");
    expect(hasFinding(report, "unused-dev-dependency", "optional-dev-peer")).toBe(false);
  });

  it("does not report optional peers in strict-mode fixtures", async () => {
    const report = await analyzeFixture("strict-optional-peer");
    expect(hasFinding(report, "unused-peer-dependency", "strict-optional-peer")).toBe(false);
  });

  it("reports unused required peer dependencies", async () => {
    const report = await analyzeFixture("unused-peer-dependency");
    expect(hasFinding(report, "unused-peer-dependency", "unused-required-peer")).toBe(true);
  });

  it("distinguishes node-protocol builtins from packages with builtin names", async () => {
    const report = await analyzeFixture("node-protocol-builtin");
    expect(hasFinding(report, "missing-dependency", "node:fs")).toBe(false);
    expect(hasFinding(report, "unused-dependency", "fs")).toBe(true);
  });

  it("detects unused DefinitelyTyped packages", async () => {
    const report = await analyzeFixture("unused-definitely-typed");
    expect(hasFinding(report, "unused-dev-dependency", "@types/unused-definitely-typed")).toBe(
      true,
    );
  });

  it("accounts for a production type-only import", async () => {
    const report = await analyzeFixture("production-type-only-import");
    expect(hasFinding(report, "unused-dependency", "production-type-runtime")).toBe(false);
  });
});

void fixturesRoot;
