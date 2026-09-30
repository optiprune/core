import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import { parseModule } from "../../src/parser.js";

const fixturesRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/functions/reported-edge-cases/cases",
);
const fixture = (name: string) => path.join(fixturesRoot, name);

describe("reported edge-case regressions", () => {
  it("lowers orphan-file confidence when an entry can import an unknown module", async () => {
    const rootDir = fixture("opaque-dynamic");
    const report = await analyze({
      rootDir,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      ignore: [],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unknown-dynamic-import" && finding.file.endsWith("src/index.ts"),
      ),
    ).toBe(true);
    const orphan = report.findings.find(
      (finding) =>
        finding.rule === "unreachable-file" && finding.file.endsWith("src/plugins/plugin-one.ts"),
    );
    expect(orphan).toBeDefined();
    expect(orphan?.confidence).toBe("low");
  });

  it("marks files under a statically-resolved readdir alias as maybe reachable", async () => {
    const rootDir = fixture("indirect-directory-loader");
    const report = await analyze({
      rootDir,
      entry: ["src/entry.mjs"],
      extensions: [".mjs"],
      ignore: [],
      includeConventionalEntries: false,
      layers: { skip3: true, skip4: true },
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" &&
          finding.file.endsWith("src/module-cache-7f3/plugin-one.mjs"),
      ),
    ).toBe(false);
  });

  it("does not mistake a same-named local for a read of the exported binding", async () => {
    const rootDir = fixture("shadowed-local");
    const report = await analyze({
      rootDir,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      ignore: [],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-export" &&
          finding.file.endsWith("src/lib.ts") &&
          finding.evidence.exportName === "hidden",
      ),
    ).toBe(true);
  });

  it("resolves references through the active lexical scopes, including defaults and TDZ", async () => {
    const rootDir = fixture("lexical-scope-resolution");
    const report = await analyze({
      rootDir,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      ignore: [],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    const unusedNames = report.findings
      .filter((finding) => finding.rule === "unused-export" && finding.file.endsWith("src/lib.ts"))
      .map((finding) => finding.evidence.exportName);
    expect(unusedNames).toContain("selfInitialized");
    expect(unusedNames).toContain("parameterShadowed");
    expect(unusedNames).not.toContain("parameterDefaultOuter");
  });

  it("reports named exports whose imported local bindings are never read", async () => {
    const rootDir = fixture("imported-but-unread");
    const report = await analyze({
      rootDir,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      ignore: [],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    const unusedNames = report.findings
      .filter((finding) => finding.rule === "unused-export" && finding.file.endsWith("src/lib.ts"))
      .map((finding) => finding.evidence.exportName);
    expect(unusedNames).toContain("neverRead");
    expect(unusedNames).toContain("trulyUnimported");
  });

  it("retains a side-effectful dependency when an imported named binding is unread", async () => {
    const rootDir = fixture("side-effect-import");
    const entryFile = path.join(rootDir, "src/index.ts");
    const entrySource = await readFile(entryFile, "utf8");
    const parsedEntry = parseModule(entrySource, entryFile);
    expect(parsedEntry.edges).toHaveLength(1);
    expect(parsedEntry.edges[0]?.importedNames).toEqual([]);

    const report = await analyze({
      rootDir,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      ignore: [],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unreachable-file" && finding.file.endsWith("src/polyfills.ts"),
      ),
    ).toBe(false);
    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-export" &&
          finding.file.endsWith("src/polyfills.ts") &&
          finding.evidence.exportName === "version",
      ),
    ).toBe(true);
  });

  it("counts imported JSX component tags as reads of their bindings", async () => {
    const rootDir = fixture("jsx-component");
    const report = await analyze({
      rootDir,
      entry: ["src/index.tsx"],
      extensions: [".tsx"],
      ignore: [],
      includeConventionalEntries: false,
      reportUnusedExports: true,
      layers: { skip3: true, skip4: true },
    });

    expect(
      report.findings.some(
        (finding) =>
          finding.rule === "unused-export" &&
          finding.file.endsWith("src/Button.tsx") &&
          finding.evidence.exportName === "Button",
      ),
    ).toBe(false);
  });
});
