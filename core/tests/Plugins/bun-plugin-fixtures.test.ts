import { describe, expect, it } from "vitest";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { analyze } from "../../src/index.js";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/plugins");

async function analyzeFixture(name: string) {
  return analyze({
    rootDir: path.join(fixtures, name),
    entry: [],
    extensions: [".js", ".ts", ".json", ".toml"],
    includeConventionalEntries: true,
    reportUnusedExports: true,
  });
}

function unreachable(report: Awaited<ReturnType<typeof analyze>>) {
  return report.findings
    .filter((finding) => finding.rule === "unreachable-file")
    .map((finding) => finding.file);
}

function packageFindings(report: Awaited<ReturnType<typeof analyze>>, packageName: string) {
  return report.findings.filter((finding) => finding.evidence?.package === packageName);
}

describe("Bun plugin fixtures", () => {
  it.each(["bun-cli-r", "bun-cli-require", "bun-cli-multiple"])(
    "marks CLI preload files from %s",
    async (fixture) => {
      const report = await analyzeFixture(fixture);
      expect(unreachable(report)).not.toEqual(
        expect.arrayContaining([expect.stringContaining("setup.ts")]),
      );
      expect(unreachable(report)).not.toEqual(
        expect.arrayContaining([expect.stringContaining("one.ts")]),
      );
    },
  );

  it("keeps a package referenced by a CLI preload alive", async () => {
    const report = await analyzeFixture("bun-cli-package-preload");
    expect(packageFindings(report, "dotenv")).toHaveLength(0);
  });

  it.each(["bunfig-preload", "bunfig-test-preload", "bunfig-loader"])(
    "marks preload files declared by %s",
    async (fixture) => {
      const report = await analyzeFixture(fixture);
      expect(unreachable(report)).not.toEqual(
        expect.arrayContaining([expect.stringContaining("setup.ts")]),
      );
      expect(unreachable(report)).not.toEqual(
        expect.arrayContaining([expect.stringContaining("test-setup.ts")]),
      );
      expect(unreachable(report)).not.toEqual(
        expect.arrayContaining([expect.stringContaining("loader-setup.ts")]),
      );
    },
  );

  it("parses multiline top-level and [test] preload arrays", async () => {
    const report = await analyzeFixture("bunfig-multiline");
    for (const file of ["src/one.ts", "src/two.ts", "src/test-setup.ts"]) {
      expect(unreachable(report)).not.toEqual(
        expect.arrayContaining([expect.stringContaining(file)]),
      );
    }
  });

  it("does not mark a colliding basename outside the exact preload path", async () => {
    const report = await analyzeFixture("bun-path-collision");
    expect(unreachable(report)).toEqual(
      expect.arrayContaining([expect.stringContaining("packages/other/setup.ts")]),
    );
    expect(unreachable(report)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("src/setup.ts")]),
    );
  });

  it("recognizes Bun test defaults, custom roots, and helpers", async () => {
    for (const fixture of ["bun-test-default", "bun-test-custom", "bun-test-helper"]) {
      const report = await analyzeFixture(fixture);
      expect(report.findings.filter((finding) => finding.rule === "plugin-error")).toHaveLength(0);
    }
  });

  it("traces Bun.build entrypoints and external packages", async () => {
    const api = await analyzeFixture("bun-build-api");
    expect(unreachable(api)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("src/index.ts")]),
    );

    const external = await analyzeFixture("bun-build-external");
    expect(packageFindings(external, "external-lib")).toHaveLength(0);
    expect(unreachable(external)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("src/index.ts")]),
    );
  });

  it("preserves bun native modules and type packages", async () => {
    for (const fixture of ["bun-native-types", "bun-native-sqlite"]) {
      const report = await analyzeFixture(fixture);
      expect(
        report.findings.filter((finding) => finding.rule === "unresolved-import"),
      ).toHaveLength(0);
      expect(packageFindings(report, "bun-types")).toHaveLength(0);
    }
  });

  it("handles Bun workspace and lifecycle scripts", async () => {
    for (const fixture of ["bun-workspace", "bun-lifecycle"]) {
      const report = await analyzeFixture(fixture);
      expect(report.findings.filter((finding) => finding.rule === "plugin-error")).toHaveLength(0);
    }
  });

  it("keeps a declared preload live but reports a genuinely dead package", async () => {
    const preload = await analyzeFixture("bun-dead-preload");
    expect(unreachable(preload)).not.toEqual(
      expect.arrayContaining([expect.stringContaining("unused-setup.ts")]),
    );

    const dead = await analyzeFixture("bun-dead-package");
    expect(packageFindings(dead, "unused-bun-helper")).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "unused-dev-dependency" })]),
    );
  });
});
