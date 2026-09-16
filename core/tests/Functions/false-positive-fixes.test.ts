import fs from "node:fs/promises";
import os from "node:os";
import path from "pathe";
import { describe, expect, it } from "vitest";
import { PluginEngine } from "../../src/engine.js";
import { AngularPlugin } from "../../src/plugins/angular-plugin.js";
import { SveltePlugin } from "../../src/plugins/svelte-plugin.js";
import { parseModule } from "../../src/parser.js";
import { analyzeLayer3 } from "../../src/layer3.js";
import type { AnalysisContext, ModuleRecord, ResolvedOptions } from "../../src/types.js";

function makeContext(rootDir: string, modules: Map<string, ModuleRecord>): AnalysisContext {
  const options: ResolvedOptions = {
    rootDir,
    entry: [],
    extensions: [".ts", ".tsx", ".js", ".svelte"],
    ignore: [],
    reportUnusedExports: true,
    schemaEnums: {},
    failOn: "none",
    json: false,
    includeConventionalEntries: false,
    pathAliases: new Map(),
    externalContracts: [],
    layers: { smtTimeoutMs: 1000, isolateMemoryLimitMb: 128, enableConcolicProof: false },
    rules: {},
  };
  return {
    options,
    modules,
    entryPoints: new Set(),
    reachable: new Set(),
    maybeReachable: new Set(),
    components: [],
    usedExports: new Set(),
    usedPackages: new Set(),
    runtimeUsedFiles: new Set(),
    usedExportConfidence: new Map(),
    candidateBranches: [],
  };
}

describe("false-positive fixes", () => {
  it("resolves Angular templateUrl relative to the component", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-angular-fixed-"));
    try {
      const sourceFile = path.join(root, "src/app/foo.component.ts");
      const templateFile = path.join(root, "src/app/foo.component.html");
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(templateFile, "<p>live</p>");
      const modules = new Map([
        [
          sourceFile,
          parseModule(
            "import { Component } from '@angular/core';\n@Component({ templateUrl: './foo.component.html' })\nexport class Foo {}",
            sourceFile,
          ),
        ],
      ]);
      const ctx = makeContext(root, modules);
      const engine = new PluginEngine();
      const adapter = (engine as any).createAdapter(ctx);
      adapter.markRelativeFileAsUsed(sourceFile, "./foo.component.html");
      expect(ctx.reachable.has(templateFile)).toBe(true);
      // AngularPlugin uses this adapter method for templateUrl/styleUrl metadata.
      engine.register(AngularPlugin);
      AngularPlugin.enabled = true;
      await engine.run(ctx, { skipDetection: true });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("preserves the full Svelte scoped package name", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-svelte-fixed-"));
    try {
      const file = path.join(root, "src/Widget.ts");
      await fs.mkdir(path.dirname(file), { recursive: true });
      const ctx = makeContext(
        root,
        new Map([[file, parseModule("import { page } from '@sveltejs/kit';", file)]]),
      );
      const engine = new PluginEngine();
      engine.register(SveltePlugin);
      SveltePlugin.enabled = true;
      await engine.run(ctx, { skipDetection: true });
      expect(ctx.usedPackages?.has("@sveltejs/kit")).toBe(true);
      expect(ctx.usedPackages?.has("@sveltejs")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not mark SvelteKit used without manifest evidence", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-svelte-route-fixed-"));
    try {
      const file = path.join(root, "src/routes/+page.ts");
      await fs.mkdir(path.dirname(file), { recursive: true });
      const ctx = makeContext(
        root,
        new Map([[file, parseModule("export const prerender = true;", file)]]),
      );
      const engine = new PluginEngine();
      engine.register(SveltePlugin);
      SveltePlugin.enabled = true;
      await engine.run(ctx, { skipDetection: true });
      expect(ctx.usedPackages?.has("@sveltejs/kit")).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not fold a shadowed identifier as a module-level constant", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "optiprune-layer3-fixed-"));
    try {
      const file = path.join(root, "shadow.ts");
      const source =
        "function flag() { return false; }\nexport function run(flag: boolean) { if (flag) { return 1; } return 0; }";
      const ctx = makeContext(root, new Map([[file, parseModule(source, file)]]));
      const findings = await analyzeLayer3(ctx);
      expect(
        findings.filter((f) => f.rule === "constant-condition" && f.confidence === "high"),
      ).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
