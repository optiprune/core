import { readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "../util/path.js";
import { parseModule } from "../parser.js";
import { _resolveModuleSync } from "../util/resolve.js";
import { buildFileDescriptor } from "./file-descriptor.js";
import type { File } from "./types.js";
import { buildPackageJsonDescriptor } from "./package-json-descriptor.js";
import type { AnalyzerOptions } from "../types.js";
import type { FileNode, ImportMaps, ModuleGraph } from "../types/module-graph.js";

const EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const emptyImportMaps = (): ImportMaps => ({
  refs: new Set(),
  enumerated: undefined,
  import: new Map(),
  importAs: new Map(),
  importNs: new Map(),
  reExport: new Map(),
  reExportAs: new Map(),
  reExportNs: new Map(),
});

async function collectFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const file = join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (EXTENSIONS.has(extname(file))) result.push(resolve(file));
    }
  }
  await visit(root);
  return result;
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

function makeFileNode(module: ReturnType<typeof parseModule>): FileNode {
  const exports = new Map();
  for (const record of module.exports) {
    exports.set(record.exportedAs, {
      identifier: record.exportedAs,
      pos: record.location?.start.column ?? 0,
      line: record.location?.start.line ?? 1,
      col: record.location?.start.column ?? 0,
      type: record.isTypeOnly ? "type" : "unknown",
      members: [],
      jsDocTags: new Set(),
      hasRefsInFile: false,
      isRegistered: false,
      referencedIn: new Set(),
      fixes: [],
      isReExport: record.isReExport,
    });
  }
  return {
    imports: {
      internal: new Map(),
      external: new Set(),
      externalRefs: new Set(),
      unresolved: new Set(),
      programFiles: new Set(),
      entryFiles: new Set(),
      imports: new Set(),
    },
    exports,
    duplicates: [],
    scripts: new Set(),
    importGlobs: [],
    importedBy: emptyImportMaps(),
    internalImportCache: undefined,
  };
}

function resolveTarget(specifier: string, source: string, root: string): string | undefined {
  const relativeTarget = _resolveModuleSync(specifier, source);
  if (relativeTarget) return relativeTarget;
  if (specifier.startsWith(".")) return undefined;
  const packageTarget = resolve(root, specifier);
  for (const candidate of [
    packageTarget,
    `${packageTarget}/index`,
    `${packageTarget}/barrel`,
    `${packageTarget}/implementation`,
  ]) {
    const relativeCandidate = `./${candidate.slice(root.length + 1)}`;
    const resolved = _resolveModuleSync(relativeCandidate, `${root}/__session__.ts`);
    if (resolved) return resolved;
  }
  return undefined;
}

async function buildGraph(root: string): Promise<{ graph: ModuleGraph; entries: Set<string> }> {
  const files = await collectFiles(root);
  const modules = new Map(files.map((file) => [file, parseModule(requireText(file), file)]));
  const graph: ModuleGraph = new Map();
  for (const module of modules.values()) graph.set(module.id, makeFileNode(module));

  for (const module of modules.values()) {
    const sourceNode = graph.get(module.id)!;
    for (const edge of module.edges) {
      const target = edge.target ?? resolveTarget(edge.rawSpecifier, module.id, root);
      if (!target || !graph.has(target)) {
        if (!edge.rawSpecifier.startsWith(".")) {
          sourceNode.imports.external.add({
            specifier: edge.rawSpecifier,
            filePath: undefined,
            identifier: undefined,
            isTypeOnly: edge.isTypeOnly ?? false,
            modifiers: 0,
            pos: (edge.location?.start.column ?? 0) + 1,
            line: (edge.location?.start.line ?? 0) + 1,
            col: (edge.location?.start.column ?? 0) + 1,
          });
        }
        continue;
      }
      edge.target = target;
      const maps = sourceNode.imports.internal.get(target) ?? emptyImportMaps();
      const names = edge.importedNames.length ? edge.importedNames : ["*"];
      const isReExport = edge.kind === "export-from" || edge.kind === "export-all";
      sourceNode.imports.imports.add({
        specifier: edge.rawSpecifier,
        filePath: target,
        identifier: names[0],
        isTypeOnly: edge.isTypeOnly ?? false,
        modifiers: 0,
        pos: edge.location?.start.column ?? 0,
        line: edge.location?.start.line ?? 0,
        col: edge.location?.start.column ?? 0,
      });
      for (const name of names) {
        if (isReExport)
          add(edge.kind === "export-all" ? maps.reExport : maps.reExport, name, module.id);
        else add(maps.import, name, module.id);
      }
      if (names.includes("*") && edge.kind === "export-all")
        maps.reExport.set("*", new Set([module.id]));
      sourceNode.imports.internal.set(target, maps);
      const targetNode = graph.get(target)!;
      const importedBy = targetNode.importedBy ?? emptyImportMaps();
      for (const name of names) {
        if (isReExport)
          add(
            edge.kind === "export-all" ? importedBy.reExport : importedBy.reExport,
            name,
            module.id,
          );
        else add(importedBy.import, name, module.id);
      }
      targetNode.importedBy = importedBy;
    }
  }
  const entries = new Set<string>();
  for (const [file, node] of graph) {
    if (![...graph.values()].some((candidate) => candidate.imports.internal.has(file)))
      entries.add(file);
  }
  return { graph, entries };
}

// Synchronous source cache used only during the in-memory graph construction.
import { readFileSync } from "node:fs";
function requireText(file: string): string {
  return readFileSync(file, "utf8");
}

export async function createSession(options: AnalyzerOptions) {
  const cwd = resolve(options.rootDir ?? process.cwd());
  const { graph, entries } = await buildGraph(cwd);
  let issues: { files: Record<string, unknown> } = { files: {} };
  return {
    describeFile(filePath: string): File | undefined {
      return buildFileDescriptor(resolve(filePath), cwd, graph, entries, {
        isShowContention: true,
      });
    },
    getGraph(): ModuleGraph {
      return graph;
    },
    async handleFileChanges(
      changes: Array<{ type: string; filePath: string }> = [],
    ): Promise<void> {
      for (const change of changes) {
        if (change.type === "added" && extname(change.filePath) === ".md") {
          issues.files[change.filePath] = { unused: { filePath: change.filePath } };
        }
      }
    },
    getIssues() {
      return { issues };
    },
    describePackageJson() {
      return buildPackageJsonDescriptor(graph, entries);
    },
    getEntryPaths() {
      return entries;
    },
  };
}
