import { promises as fs } from "node:fs";
import os from "node:os";
import path from "pathe";
import { afterEach, describe, expect, it } from "vitest";
import { analyze } from "../../src/index.js";
import { calculateReachability } from "../../src/graph.js";
import { PluginEngine } from "../../src/engine.js";
import { parseModule } from "../../src/parser.js";
import { formatSarif, formatTerminal } from "../../src/reporters.js";
import { resolveDynamicPattern } from "../../src/fs-utils.js";
import type { AnalysisContext, ModuleRecord } from "../../src/types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function moduleRecord(id: string, overrides: Partial<ModuleRecord> = {}): ModuleRecord {
  return {
    id,
    relativePath: id,
    parseStatus: "parsed",
    parseDiagnostics: [],
    sourceText: "",
    exports: [],
    edges: [],
    hasUnknownDynamicBoundary: false,
    hasParseError: false,
    hasUnresolvedCommonJsExports: false,
    scannedDirectories: [],
    dynamicImportCandidates: [],
    ...overrides,
  };
}

function pluginContext(rootDir: string, modules: Map<string, ModuleRecord>): AnalysisContext {
  return {
    options: { rootDir, ignore: [], extensions: [".ts"] } as AnalysisContext["options"],
    modules,
    entryPoints: new Set(modules.keys()),
    reachable: new Set(),
    maybeReachable: new Set(),
    runtimeUsedFiles: new Set(),
    semanticConfigMembers: new Set(),
    runtimeUsedMembers: new Set(),
    hasReachableUnknownDynamicBoundary: false,
    components: [],
    usedExports: new Set(),
    usedExportConfidence: new Map(),
    usedMembers: new Set(),
    candidateBranches: [],
    dynamicImportCandidates: [],
    usedPackages: new Set(),
    enabledPlugins: new Set(),
  };
}

describe("hardening regressions", () => {
  it("does not treat a sibling prefix as a scanned directory child", () => {
    const loader = "/repo/src/loader.ts";
    const modules = new Map([
      [
        loader,
        moduleRecord(loader, {
          scannedDirectories: ["plugins"],
          edges: [
            {
              source: loader,
              rawSpecifier: "./plugins/${name}",
              kind: "dynamic-pattern",
              importedNames: [],
              resolution: "unknown",
            },
          ],
        }),
      ],
      ["/repo/src/plugins/a.ts", moduleRecord("/repo/src/plugins/a.ts")],
      ["/repo/src/plugins-old/a.ts", moduleRecord("/repo/src/plugins-old/a.ts")],
    ]);
    const result = calculateReachability(modules, new Set([loader]));
    expect(result.maybeReachable.has("/repo/src/plugins/a.ts")).toBe(true);
    expect(result.maybeReachable.has("/repo/src/plugins-old/a.ts")).toBe(false);
    expect(
      resolveDynamicPattern(
        loader,
        "./plugins/",
        "",
        new Set(["/repo/src/plugins/a.ts", "/repo/src/plugins-old/a.ts"]),
      ),
    ).toEqual(["/repo/src/plugins/a.ts"]);
  });

  it("keeps unrelated files reportable when an entry has an unknown dynamic boundary", () => {
    const entry = "/repo/src/index.ts";
    const dead = "/repo/src/dead.ts";
    const modules = new Map([
      [
        entry,
        moduleRecord(entry, {
          hasUnknownDynamicBoundary: true,
          edges: [
            {
              source: entry,
              rawSpecifier: "./${name}",
              kind: "unknown-dynamic",
              importedNames: [],
              resolution: "unknown",
            },
          ],
        }),
      ],
      [dead, moduleRecord(dead)],
    ]);
    const result = calculateReachability(modules, new Set([entry]));
    expect(result.hasReachableUnknownDynamicBoundary).toBe(true);
    expect(result.maybeReachable.has(dead)).toBe(false);
  });

  it("invalidates the cached report when equal-length source content changes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-cache-hardening-"));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "package.json"), '{"name":"cache-hardening"}');
    const index = path.join(root, "src/index.ts");
    await fs.writeFile(index, 'import "./live.js";\n');
    await fs.writeFile(path.join(root, "src/live.ts"), "export const live = 1;\n");
    await fs.writeFile(path.join(root, "src/dead.ts"), "export const dead = 1;\n");
    const options = {
      rootDir: root,
      entry: ["src/index.ts"],
      extensions: [".ts"],
      layers: { skip3: true, skip4: true },
    };
    const first = await analyze(options);
    expect(
      first.modules.find((module) => module.path.endsWith("src/index.ts"))?.edges[0]?.specifier,
    ).toBe("./live.js");
    const stat = await fs.stat(index);
    await fs.writeFile(index, 'import "./dead.js";\n');
    await fs.utimes(index, stat.atime, stat.mtime);
    const second = await analyze(options);
    expect(
      second.modules.find((module) => module.path.endsWith("src/index.ts"))?.edges[0]?.specifier,
    ).toBe("./dead.js");
  });

  it("reports plugin AST failures instead of silently losing plugin work", async () => {
    const file = "/repo/src/index.ts";
    const context = pluginContext(
      "/repo",
      new Map([[file, parseModule("const value = 1;", file)]]),
    );
    const engine = new PluginEngine();
    engine.register({
      name: "throwing-plugin",
      version: "1.0.0",
      enabled: true,
      lifecycle: {
        onASTNode: () => {
          throw new Error("bad AST");
        },
      },
    });
    const findings = await engine.run(context, { skipDetection: true });
    expect(
      findings.some(
        (finding) => finding.rule === "plugin-error" && finding.evidence.phase === "onASTNode",
      ),
    ).toBe(true);
  });

  it("resolves extensionless plugin file marks to analyzed modules", async () => {
    const file = "/repo/src/main.ts";
    const context = pluginContext(
      "/repo",
      new Map([[file, parseModule("export const main = 1;", file)]]),
    );
    const engine = new PluginEngine();
    engine.register({
      name: "marking-plugin",
      version: "1.0.0",
      enabled: true,
      lifecycle: { onFileStart: (_file, adapter) => adapter.markAsUsed("src/main") },
    });
    await engine.run(context, { skipDetection: true });
    expect(context.reachable.has(file)).toBe(true);
  });

  it("preserves info severity in terminal and SARIF output", () => {
    const report = {
      version: "1.0.0",
      rootDir: "/repo",
      entryPoints: [],
      summary: {
        filesDiscovered: 0,
        filesParsed: 0,
        filesRecovered: 0,
        filesFallback: 0,
        edges: 0,
        entryPoints: 0,
        stronglyConnectedComponents: 0,
        cycles: 0,
        findings: 1,
        errors: 0,
        warnings: 0,
      },
      findings: [
        {
          rule: "parse-recovery",
          severity: "info",
          confidence: "low",
          message: "informational",
          file: "/repo/src/a.ts",
          evidence: {},
        },
      ],
      modules: [],
      components: [],
    } as any;
    expect(formatTerminal(report)).toContain("\x1b[36mINFO");
    const sarif = JSON.parse(formatSarif(report));
    expect(sarif.runs[0].results[0].level).toBe("note");
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      "src/a.ts",
    );
    report.findings[0].file = "/repo/src/a file.ts";
    expect(
      JSON.parse(formatSarif(report)).runs[0].results[0].locations[0].physicalLocation
        .artifactLocation.uri,
    ).toBe("src/a%20file.ts");
  });
});
