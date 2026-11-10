import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { PluginEngine } from "../../src/engine.js";
import { parseModule } from "../../src/parser.js";
import type { AnalysisContext, AnalyzerPlugin } from "../../src/types.js";

function makeContext(rootDir: string, modules = new Map()): AnalysisContext {
  return {
    modules,
    options: { rootDir },
    reachable: new Set(),
    runtimeUsedFiles: new Set(),
    usedExports: new Set(),
    usedPackages: new Set(),
    enabledPlugins: new Set(),
    usedMembers: new Set(),
    runtimeUsedMembers: new Set(),
    semanticConfigMembers: new Set(),
    usedExportConfidence: new Map(),
  } as unknown as AnalysisContext;
}

function moduleRecord(id: string) {
  const parsed = parseModule("export const value = 1;", id);
  return { id, ast: parsed.ast, edges: [], exports: [] };
}

describe("Plugin engine lifecycle regressions", () => {
  it("keeps adapter-scoped state across the init and execution passes", async () => {
    const engine = new PluginEngine();
    const probe: AnalyzerPlugin = {
      name: "state-probe-plugin",
      version: "1.0.0",
      lifecycle: {
        onProjectInit(adapter) {
          (adapter as any).__probeState = { visited: false };
        },
        onASTNode(_node, _fileId, adapter) {
          (adapter as any).__probeState.visited = true;
        },
        onAnalysisComplete(adapter) {
          adapter.emitFinding({
            severity: "info",
            confidence: "high",
            message: `state-visited:${(adapter as any).__probeState?.visited === true}`,
            file: adapter.getConfig().rootDir,
            evidence: {},
          });
        },
      },
    };
    engine.register(probe);
    const rootDir = process.cwd();
    await engine.run(makeContext(rootDir));
    const finalContext = makeContext(rootDir);
    const fileId = path.join(rootDir, "src/index.ts");
    finalContext.modules.set(fileId, moduleRecord(fileId) as any);
    const findings = await engine.run(finalContext, { skipDetection: true });
    expect(findings.some((finding) => finding.message === "state-visited:true")).toBe(true);
  });

  it("runs onAnalysisComplete exactly once, after the graph exists", async () => {
    const engine = new PluginEngine();
    let calls = 0;
    const probe: AnalyzerPlugin = {
      name: "completion-probe-plugin",
      version: "1.0.0",
      lifecycle: {
        onAnalysisComplete(adapter) {
          calls += 1;
          adapter.emitFinding({
            severity: "info",
            confidence: "high",
            message: "completion-probe-finding",
            file: adapter.getConfig().rootDir,
            evidence: {},
          });
        },
      },
    };
    engine.register(probe);
    const rootDir = process.cwd();
    await engine.run(makeContext(rootDir));
    const finalContext = makeContext(rootDir);
    const fileId = path.join(rootDir, "src/index.ts");
    finalContext.modules.set(fileId, moduleRecord(fileId) as any);
    const findings = await engine.run(finalContext, { skipDetection: true });
    expect(calls).toBe(1);
    expect(
      findings.filter((finding) => finding.message === "completion-probe-finding"),
    ).toHaveLength(1);
  });

  it("turns onProjectInit failures into plugin-error findings and disables the plugin", async () => {
    const engine = new PluginEngine();
    const probe: AnalyzerPlugin = {
      name: "init-error-probe-plugin",
      version: "1.0.0",
      lifecycle: {
        onProjectInit() {
          throw new Error("init probe boom");
        },
      },
    };
    engine.register(probe);
    const findings = await engine.run(makeContext(process.cwd()));
    expect(
      findings.some(
        (finding) =>
          finding.rule === "plugin-error" &&
          finding.evidence?.phase === "onProjectInit" &&
          finding.evidence?.plugin === "init-error-probe-plugin",
      ),
    ).toBe(true);
    expect(probe.enabled).toBe(false);
  });

  it("catches rejected async onASTNode hooks without crashing", async () => {
    const engine = new PluginEngine();
    const probe: AnalyzerPlugin = {
      name: "async-ast-probe-plugin",
      version: "1.0.0",
      lifecycle: {
        async onASTNode() {
          await Promise.resolve();
          throw new Error("async ast probe boom");
        },
      },
    };
    engine.register(probe);
    const rootDir = process.cwd();
    await engine.run(makeContext(rootDir));
    const finalContext = makeContext(rootDir);
    const fileId = path.join(rootDir, "src/index.ts");
    finalContext.modules.set(fileId, moduleRecord(fileId) as any);
    const findings = await engine.run(finalContext, { skipDetection: true });
    expect(
      findings.some(
        (finding) =>
          finding.rule === "plugin-error" &&
          finding.evidence?.phase === "onASTNode" &&
          finding.evidence?.plugin === "async-ast-probe-plugin",
      ),
    ).toBe(true);
  });

  it("reads BOM-prefixed and JSONC configuration through the adapter", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-engine-"));
    try {
      await fs.writeFile(path.join(rootDir, "package.json"), '\uFEFF{"name":"bom-fixture"}');
      await fs.writeFile(
        path.join(rootDir, "tsconfig.json"),
        '{ // JSONC comment\n  "compilerOptions": {"jsx": "react-jsx",}\n}\n',
      );
      const adapter = new PluginEngine().createAdapter(makeContext(rootDir));
      expect(await adapter.readJson("package.json")).toEqual({ name: "bom-fixture" });
      expect(await adapter.readJson("tsconfig.json")).toEqual({
        compilerOptions: { jsx: "react-jsx" },
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("resolves relative source IDs in markRelativeFileAsUsed against rootDir", () => {
    const rootDir = "/tmp/optiprune-relative-fixture";
    const context = makeContext(rootDir);
    const adapter = new PluginEngine().createAdapter(context);
    adapter.markRelativeFileAsUsed("src/index.ts", "./helper.ts");
    expect(context.reachable.has(path.join(rootDir, "src/helper.ts"))).toBe(true);
  });

  it("accepts filename-stem aliases for config overrides", async () => {
    const engine = new PluginEngine();
    const context = makeContext(process.cwd());
    (context.options as any).plugins = { "nuxtjs-plugin": true };
    await engine.run(context);
    const nuxt = ((engine as any).plugins as AnalyzerPlugin[]).find(
      (plugin) => plugin.name === "nuxt-plugin",
    );
    expect(nuxt?.enabled).toBe(true);
  });
});
