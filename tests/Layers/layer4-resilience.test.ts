import { describe, expect, it } from "vitest";
import path from "pathe";
import { analyzeLayer4 } from "../../src/layer4.js";
import type {
  AnalysisContext,
  DependencyEdge,
  ModuleRecord,
  ResolvedOptions,
} from "../../src/types.js";

function makeModule(id: string, overrides: Partial<ModuleRecord> = {}): ModuleRecord {
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

function makeOptions(rootDir: string): ResolvedOptions {
  return {
    rootDir,
    entry: [],
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    ignore: [],
    reportUnusedExports: true,
    schemaEnums: {},
    failOn: "none",
    json: false,
    includeConventionalEntries: false,
    pathAliases: new Map(),
    externalContracts: [],
    verbose: false,
    layers: {
      smtTimeoutMs: 50,
      isolateMemoryLimitMb: 16,
      enableConcolicProof: false,
      skip3: false,
      skip4: false,
    },
    rules: {},
  };
}

describe("Layer 4: resilient TypeScript dynamic-import simulation", () => {
  it("compiles TypeScript, ignores an unknown global, and resolves a dynamic-pattern edge", async () => {
    // Use a virtual root. pathe ensures this works consistently across OSs.
    const rootDir = "/virtual/project";
    const sourceFile = path.join(rootDir, "entry.ts");
    const targetFile = path.join(rootDir, "plugins", "resilient-plugin.ts");

    const edge: DependencyEdge = {
      source: sourceFile,
      rawSpecifier: "./plugins/${…}.ts",
      kind: "dynamic-pattern",
      importedNames: ["*"],
      resolution: "unknown",
      location: {
        start: { line: 12, column: 6 },
        end: { line: 12, column: 48 },
      },
      dynamicPattern: {
        prefix: "./plugins/",
        suffix: ".ts",
        baseDirectory: "",
        candidates: [],
      },
    };

    const sourceModule = makeModule(sourceFile, { edges: [edge] });
    const targetModule = makeModule(targetFile, {
      exports: [
        {
          name: "resilientPlugin",
          exportedAs: "resilientPlugin",
          isDefault: false,
          isReExport: false,
          isWildcard: false,
        },
      ],
    });

    const context: AnalysisContext = {
      options: makeOptions(rootDir),
      modules: new Map([
        [sourceFile, sourceModule],
        [targetFile, targetModule],
      ]),
      entryPoints: new Set([sourceFile]),
      reachable: new Set([sourceFile]),
      maybeReachable: new Set(),
      hasReachableUnknownDynamicBoundary: false,
      components: [],
      usedExports: new Set(),
      candidateBranches: [],
      dynamicImportCandidates: [
        {
          file: sourceFile,
          line: 12,
          column: 6,
          expression: "import(`./plugins/${pluginName}.ts`)",
          contextCode: `
            interface PluginDescriptor { enabled: boolean }
            type PluginName = "resilient-plugin";

            const pluginName: PluginName = "resilient-plugin";
            const descriptor = unknownFramework.configure({ enabled: true }) as PluginDescriptor;
            void descriptor;
            await import(\`./plugins/\${pluginName}.ts\`);
          `,
        },
      ],
    };

    const findings = await analyzeLayer4(context);

    expect(findings).toEqual([]);
    expect(edge.resolution).toBe("resolved");
    expect(context.reachable).toContain(targetFile);
    expect(context.usedExports).toContain(`${targetFile}:resilientPlugin`);
  });

  it("resolves concatenated dynamic imports in the sandbox", async () => {
    const rootDir = "/virtual/project";
    const sourceFile = path.join(rootDir, "entry.ts");
    const targetFile = path.join(rootDir, "plugins", "resilient-plugin.ts");
    const edge: DependencyEdge = {
      source: sourceFile,
      rawSpecifier: "./plugins/${…}.ts",
      kind: "dynamic-pattern",
      importedNames: ["*"],
      resolution: "unknown",
      location: { start: { line: 3, column: 6 }, end: { line: 3, column: 52 } },
      dynamicPattern: { prefix: "./plugins/", suffix: ".ts", baseDirectory: "", candidates: [] },
    };
    const sourceModule = makeModule(sourceFile, { edges: [edge] });
    const targetModule = makeModule(targetFile, {
      exports: [
        {
          name: "resilientPlugin",
          exportedAs: "resilientPlugin",
          isDefault: false,
          isReExport: false,
          isWildcard: false,
        },
      ],
    });
    const context: AnalysisContext = {
      options: makeOptions(rootDir),
      modules: new Map([
        [sourceFile, sourceModule],
        [targetFile, targetModule],
      ]),
      entryPoints: new Set([sourceFile]),
      reachable: new Set([sourceFile]),
      maybeReachable: new Set(),
      hasReachableUnknownDynamicBoundary: false,
      components: [],
      usedExports: new Set(),
      candidateBranches: [],
      dynamicImportCandidates: [
        {
          file: sourceFile,
          line: 3,
          column: 6,
          expression: "import('./plugins/' + suffix + '.ts')",
          contextCode: `
          let suffix;
          suffix = "resilient-plugin";
          await import('./plugins/' + suffix + '.ts');
        `,
        },
      ],
    };

    const findings = await analyzeLayer4(context);
    expect(findings).toEqual([]);
    expect(edge.resolution).toBe("resolved");
    expect(context.reachable).toContain(targetFile);
    expect(context.usedExports).toContain(`${targetFile}:resilientPlugin`);
  });
});
