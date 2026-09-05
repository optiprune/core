import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { parseModule, walkAst } from "./parser.js";
import {
  buildGraph,
  contextWithGraph,
  buildImportUsage,
  calculateReachability,
  calculateComponentReachability,
  edgeTargets,
} from "./graph.js";
import { analyzeLayer2 } from "./layer2.js";
import { analyzeLayer3 } from "./layer3.js";
import { analyzeLayer4 } from "./layer4.js";
import { analyzeLayer5 } from "./layer5.js";
import { analyzeLayer6 } from "./layer6.js";
import { analyzeLayer7 } from "./layer7.js";
import { SemanticGraph } from "./semantic-graph.js";
import { TopologyManager } from "./topology-manager.js";
import { SymbolicEngine } from "./symbolic-engine.js";
import { buildMonorepoTopology } from "./workspace.js";
import { PluginEngine } from "./engine.js";
import { loadCache, saveCache, getFileHash, isCacheValid, AnalysisCache } from "./cache.js";
import { formatTerminal, formatSarif } from "./reporters.js";
import {
  compileGlobs,
  conventionalEntryPatterns,
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  discoverPackageEntryPatterns,
  discoverPackageBinEntryPatterns,
  discoverPackageExportEntryPatterns,
  discoverPackageScriptTargets,
  discoverSourceFiles,
  expandEntryPatterns,
  ingestPackageImports,
  ingestTsConfigPaths,
  normalizeAbsolute,
  matchesAnyGlob,
  TEST_IGNORE_PATTERNS,
  readJsonFile,
  readJsonFileWithDiagnostics,
  relativeDisplayPath,
  rootLooksValid,
  isConfigurationFile,
} from "./fs-utils.js";
import type {
  AnalysisContext,
  AnalyzerOptions,
  AnalysisReport,
  AnalysisSummary,
  Finding,
  ModuleRecord,
  ResolvedOptions,
} from "./types.js";
import { CONFIDENCE_RANK } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = (await readJsonFile(path.join(__dirname, "..", "package.json"))) as {
  version?: string;
} | null;
if (!pkg?.version) {
  throw new Error("Unable to determine @optiprune/core version from package.json");
}
const VERSION = pkg.version;

import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config-loader.js";
import { applyFixes as runFixes } from "./fixer.js";

function isPureStaticExpression(node: any): boolean {
  if (!node) return true;
  switch (node.type) {
    case "StringLiteral":
    case "NumericLiteral":
    case "BooleanLiteral":
    case "NullLiteral":
    case "Literal":
    case "Identifier":
      return true;
    case "UnaryExpression":
      return isPureStaticExpression(node.argument);
    case "BinaryExpression":
    case "LogicalExpression":
      return isPureStaticExpression(node.left) && isPureStaticExpression(node.right);
    case "ConditionalExpression":
      return (
        isPureStaticExpression(node.test) &&
        isPureStaticExpression(node.consequent) &&
        isPureStaticExpression(node.alternate)
      );
    case "ArrayExpression":
      return (node.elements ?? []).every((element: any) => isPureStaticExpression(element));
    case "ObjectExpression":
      return (node.properties ?? []).every((property: any) => {
        if (property.type === "SpreadElement" || property.type === "SpreadProperty") return false;
        if (property.computed && !isPureStaticExpression(property.key)) return false;
        return isPureStaticExpression(property.value);
      });
    case "TemplateLiteral":
      return (node.expressions ?? []).every((expression: any) =>
        isPureStaticExpression(expression),
      );
    case "TSAsExpression":
    case "TSTypeAssertion":
    case "TypeCastExpression":
      return isPureStaticExpression(node.expression);
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return true;
    default:
      return false;
  }
}

function isPureExportDeclaration(node: any): boolean {
  if (!node) return true;
  if (node.type === "VariableDeclaration") {
    return (node.declarations ?? []).every((declaration: any) =>
      isPureStaticExpression(declaration.init),
    );
  }
  if (node.type === "FunctionDeclaration") return true;
  // Classes may execute computed keys or static blocks at module evaluation.
  return false;
}

function isPureExportOnlyModule(module: ModuleRecord): boolean {
  const body = (module.ast as any)?.program?.body ?? (module.ast as any)?.body;
  if (!Array.isArray(body) || body.length === 0 || module.exports.length === 0) return false;

  return body.every((statement: any) => {
    if (statement.type === "ExportNamedDeclaration") {
      if (statement.source) return false;
      return isPureExportDeclaration(statement.declaration);
    }
    if (statement.type === "ExportDefaultDeclaration") {
      return (
        isPureStaticExpression(statement.declaration) ||
        isPureExportDeclaration(statement.declaration)
      );
    }
    return false;
  });
}

async function discoverCacheInputFiles(rootDir: string): Promise<string[]> {
  const ignored = new Set(["node_modules", ".git", ".optiprune", "dist", "build", "coverage"]);
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  };
  await visit(rootDir);
  return files.sort((left, right) => left.localeCompare(right));
}

async function resolveOptions(options: AnalyzerOptions): Promise<ResolvedOptions> {
  const rootDir = normalizeAbsolute(options.rootDir ?? process.cwd());

  // Load config from optiprune.json / optiprune.jsonc / optiprune.config.{ts,js,mjs}
  // / package.json#optiprune – in that priority order.
  const fileConfig = await loadConfig(rootDir);

  // CLI / programmatic options always win over file config.
  // We spread fileConfig first, then options so that explicit CLI flags
  // override whatever was read from the config file.
  const merged = mergeConfig(DEFAULT_CONFIG, {
    ...fileConfig,
    ...options,
    rootDir,
  } as import("./types.js").Config);

  // Map top-level skip flags from CLI/Options to layers object
  if (options.skip3 !== undefined) merged.layers.skip3 = options.skip3;
  if (options.skip4 !== undefined) merged.layers.skip4 = options.skip4;
  if (options.skipSmt !== undefined) merged.layers.skipSmt = options.skipSmt;
  if (merged.layers.skipSmt) merged.layers.skip3 = true;

  // Sync the legacy `json` boolean with the `output` field so both are
  // always consistent regardless of which one the caller set.
  if (options.output) {
    merged.output = options.output;
    merged.json = options.output === "json";
  } else if (typeof options.json === "boolean") {
    merged.json = options.json;
    merged.output = options.json ? "json" : "terminal";
  }

  const { paths: pathAliases, baseUrl } = await ingestTsConfigPaths(rootDir);
  const packageImports = await ingestPackageImports(rootDir);

  return {
    ...merged,
    entry: merged.entry?.map((entry) => normalizeAbsolute(path.resolve(rootDir, entry))) ?? [],
    configFiles:
      merged.configFiles?.map((file) => normalizeAbsolute(path.resolve(rootDir, file))) ?? [],
    // DEFAULT_IGNORE is already baked into mergeConfig; avoid doubling it.
    ignore: merged.ignore,
    pathAliases,
    packageImports,
    baseUrl,
  } as ResolvedOptions;
}
/** Rebase a package-local path or glob so root-level discovery can match it. */
function rebaseWorkspacePattern(rootDir: string, packageRoot: string, pattern: string): string {
  const absolutePattern = path.isAbsolute(pattern) ? pattern : path.resolve(packageRoot, pattern);
  return path.relative(rootDir, absolutePattern).replace(/\\/g, "/");
}

/**
 * Applies only the configuration fields that have package-local semantics. The
 * root configuration remains the source of global analyzer options; workspace
 * configuration can contribute its own entry points, protected configuration
 * files, discovery ignores, source extensions, external contracts, and
 * manifest-scoped dependency exceptions.
 */
async function applyWorkspacePackageConfigs(options: ResolvedOptions): Promise<void> {
  const workspaces = options.monorepo?.packageMap.values();
  if (!workspaces) return;

  const entries = new Set(options.entry);
  const configFiles = new Set(options.configFiles);
  const ignores = new Set(options.ignore);
  const extensions = new Set(options.extensions);
  const externalContracts = new Set(options.externalContracts);
  const compilers = { ...options.compilers };
  const packageIgnoreDependencies = new Map(options.packageIgnoreDependencies);

  for (const workspacePackage of workspaces) {
    const packageConfig = await loadConfig(workspacePackage.location);

    for (const entry of packageConfig.entry ?? []) {
      if (typeof entry !== "string" || entry.trim().length === 0) continue;
      entries.add(path.resolve(workspacePackage.location, entry));
    }

    for (const configFile of packageConfig.configFiles ?? []) {
      if (typeof configFile !== "string" || configFile.trim().length === 0) continue;
      configFiles.add(normalizeAbsolute(path.resolve(workspacePackage.location, configFile)));
    }

    for (const ignore of packageConfig.ignore ?? []) {
      if (typeof ignore !== "string" || ignore.trim().length === 0) continue;
      ignores.add(rebaseWorkspacePattern(options.rootDir, workspacePackage.location, ignore));
    }

    for (const extension of packageConfig.extensions ?? []) {
      if (typeof extension === "string" && extension.trim().length > 0) {
        extensions.add(extension);
      }
    }

    for (const contract of packageConfig.externalContracts ?? []) {
      if (typeof contract === "string" && contract.trim().length > 0) {
        externalContracts.add(contract);
      }
    }

    Object.assign(compilers, packageConfig.compilers ?? {});

    const ignoredDependencies = (packageConfig.ignoreDependencies ?? []).filter(
      (dependency): dependency is string =>
        typeof dependency === "string" && dependency.trim().length > 0,
    );
    if (ignoredDependencies.length > 0) {
      packageIgnoreDependencies.set(
        workspacePackage.manifestPath,
        Array.from(new Set(ignoredDependencies)),
      );
    }
  }

  options.entry = Array.from(entries);
  options.configFiles = Array.from(configFiles);
  options.ignore = Array.from(ignores);
  options.extensions = Array.from(extensions);
  options.externalContracts = Array.from(externalContracts);
  options.compilers = compilers;
  options.packageIgnoreDependencies = packageIgnoreDependencies;
}

export function shouldFail(report: AnalysisReport, failOn: ResolvedOptions["failOn"]): boolean {
  if (failOn === "none") {
    return false;
  }
  const failThreshold = CONFIDENCE_RANK[failOn];
  return report.findings.some(
    (f) => f.severity !== "info" && CONFIDENCE_RANK[f.confidence] >= failThreshold,
  );
}
export async function analyze(options: AnalyzerOptions): Promise<AnalysisReport> {
  const resolvedOptions = await resolveOptions(options);

  // Support external cache-from path
  let cache: AnalysisCache;
  if ((options as any).cacheFrom && fs.existsSync((options as any).cacheFrom)) {
    try {
      cache = JSON.parse(fs.readFileSync((options as any).cacheFrom, "utf-8"));
    } catch (e) {
      cache = loadCache(resolvedOptions.rootDir);
    }
  } else {
    cache = loadCache(resolvedOptions.rootDir);
  }

  const newCache: AnalysisCache = { version: "2.1", entries: {} };

  // Phase 1: Core Graph & AST (Instant)
  const { rootDir } = resolvedOptions;

  if (!(await rootLooksValid(rootDir))) {
    throw new Error(`Root directory does not exist: ${rootDir}`);
  }

  // Parse the root package manifest once with diagnostics. Safe JSONC-style
  // recovery keeps dependency analysis available while preserving actionable
  // errors for malformed manifests.
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJsonRead =
    await readJsonFileWithDiagnostics<Record<string, unknown>>(packageJsonPath);
  const packageJsonDiagnostics = packageJsonRead?.diagnostics ?? [];
  const packageJsonRecovered = packageJsonRead?.recovered ?? false;
  const packageJsonRepairable = packageJsonRead?.repairable ?? false;

  // ── RUN PLUGIN ENGINE INIT BEFORE FILE DISCOVERY ───────────────────────────
  // Initialize early context and run PluginEngine so CustomConfigPlugin can populate
  // resolvedOptions.ignore / entry / failOn BEFORE discoverSourceFiles is called.
  const initialModules = new Map<string, ModuleRecord>();
  const initialEntryPoints = new Set<string>();
  const earlyContext = contextWithGraph(
    initialModules,
    initialEntryPoints,
    resolvedOptions,
    new Set(),
  );

  const pluginEngine = new PluginEngine();
  const pluginFindings = await pluginEngine.run(earlyContext);

  // Package-manager and framework plugins can contribute workspace patterns
  // during their early configuration pass. Build topology only after those
  // declarations have been applied so no workspace metadata is discarded.
  let hasMonorepo = false;
  try {
    resolvedOptions.monorepo = await buildMonorepoTopology(
      resolvedOptions.rootDir,
      resolvedOptions.workspaceGlobs,
      resolvedOptions.ignoreTests ? TEST_IGNORE_PATTERNS : [],
    );
    hasMonorepo = resolvedOptions.monorepo.packageMap.size > 0;
  } catch (e) {
    // Ignore malformed package-manager configuration and continue analysis.
  }

  // Workspace packages can supply package-local entries, ignore patterns, and
  // dependency exceptions. Apply them after topology discovery and before
  // source discovery, so every package config has the same effect as a root
  // config without leaking its relative paths into sibling packages.
  if (hasMonorepo) {
    await applyWorkspacePackageConfigs(resolvedOptions);
  }

  // Re-read configuration options after plugin initialization
  const { extensions, entry, includeConventionalEntries } = resolvedOptions;
  const ignore = resolvedOptions.ignoreTests
    ? [...resolvedOptions.ignore, ...TEST_IGNORE_PATTERNS]
    : resolvedOptions.ignore;
  const compiledIgnorePatterns = compileGlobs(ignore);

  const discoveredSourceFiles = await discoverSourceFiles(
    rootDir,
    extensions,
    compiledIgnorePatterns,
  );
  const projectPatterns = resolvedOptions.projectPatterns ?? [];
  const includedProjectPatterns = projectPatterns.filter((pattern) => !pattern.startsWith("!"));
  const excludedProjectPatterns = projectPatterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  const compiledIncludedProjectPatterns = compileGlobs(includedProjectPatterns);
  const compiledExcludedProjectPatterns = compileGlobs(excludedProjectPatterns);
  // Config files remain ordinary analysis modules. Ensure declarations are kept
  // in scope even when framework project patterns would otherwise exclude them.
  const configuredConfigFilePatterns = compileGlobs(
    resolvedOptions.configFiles.map((file) => path.relative(rootDir, file).replace(/\\/g, "/")),
  );
  const configuredConfigFiles = expandEntryPatterns(
    discoveredSourceFiles,
    rootDir,
    resolvedOptions.configFiles,
  );
  const allSourceFiles = Array.from(
    new Set([
      ...(projectPatterns.length === 0
        ? discoveredSourceFiles
        : discoveredSourceFiles.filter((file) => {
            const included =
              includedProjectPatterns.length === 0 ||
              matchesAnyGlob(file, compiledIncludedProjectPatterns, rootDir);
            return included && !matchesAnyGlob(file, compiledExcludedProjectPatterns, rootDir);
          })),
      ...configuredConfigFiles,
    ]),
  ).sort((left, right) => left.localeCompare(right));

  const analysisKey = JSON.stringify({
    version: VERSION,
    entry: resolvedOptions.entry,
    configFiles: resolvedOptions.configFiles,
    extensions: resolvedOptions.extensions,
    ignore: resolvedOptions.ignore,
    ignoreTests: resolvedOptions.ignoreTests,
    ignoreUnknownImport: resolvedOptions.ignoreUnknownImport,
    layers: resolvedOptions.layers,
    rules: resolvedOptions.rules,
    reportUnusedExports: resolvedOptions.reportUnusedExports,
    reportUnusedExportsInUnreachableFiles: resolvedOptions.reportUnusedExportsInUnreachableFiles,
    includeConventionalEntries: resolvedOptions.includeConventionalEntries,
    includeEntryExports: resolvedOptions.includeEntryExports,
    includeEntryMembers: resolvedOptions.includeEntryMembers,
    cycles: resolvedOptions.cycles,
    externalContracts: resolvedOptions.externalContracts,
    plugins: resolvedOptions.plugins,
    compilers: Object.keys(resolvedOptions.compilers ?? {}).sort(),
  });
  // Include configuration and plugin metadata in cache inputs. File metadata is
  // only a cheap hint, so hashes remain the correctness check for same-size,
  // same-mtime rewrites.
  const cacheInputFiles = await discoverCacheInputFiles(rootDir);
  const currentFileStats: Record<string, { size: number; mtimeMs: number }> = {};
  for (const file of cacheInputFiles) {
    try {
      const stat = await fsp.stat(file);
      currentFileStats[file] = { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // The normal parse loop handles files that disappear during analysis.
    }
  }
  const currentFileHashes: Record<string, string> = {};
  for (const file of cacheInputFiles) {
    try {
      currentFileHashes[file] = getFileHash(await fsp.readFile(file, "utf8"));
    } catch {
      // The normal parse loop handles files that disappear during analysis.
    }
  }
  const sameHashes =
    cache.fileHashes &&
    Object.keys(cache.fileHashes).length === Object.keys(currentFileHashes).length &&
    Object.entries(currentFileHashes).every(([file, hash]) => cache.fileHashes?.[file] === hash);
  const sameStats =
    cache.fileStats &&
    Object.keys(cache.fileStats).length === Object.keys(currentFileStats).length &&
    Object.entries(currentFileStats).every(([file, stat]) => {
      const cached = cache.fileStats?.[file];
      return cached?.size === stat.size && cached.mtimeMs === stat.mtimeMs;
    });
  if (
    !resolvedOptions.fix &&
    cache.version === "2.1" &&
    cache.report &&
    cache.analysisKey === analysisKey &&
    sameStats &&
    sameHashes
  ) {
    return cache.report;
  }
  const modules = new Map<string, ModuleRecord>();
  const semanticGraph = new SemanticGraph();
  const topologyManager = new TopologyManager(semanticGraph);
  const symbolicEngine = new SymbolicEngine(semanticGraph);

  let filesParsed = 0;
  let filesRecovered = 0;
  let filesFallback = 0;
  let cacheDirty = false;
  let hasFrameworkNodes = false;

  for (const file of allSourceFiles) {
    let rawText: string;
    try {
      // BOM-safe file reader to prevent Babel/TS AST parse recovery warnings
      rawText = await fsp.readFile(file, "utf8");
    } catch (e: any) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    const sourceText = rawText.charCodeAt(0) === 0xfeff ? rawText.slice(1) : rawText;

    const currentHash = getFileHash(sourceText);

    let moduleRecord: ModuleRecord;
    const cached = cache.entries[file];

    if (cached && isCacheValid(cached, sourceText)) {
      moduleRecord = cached.moduleRecord;
      newCache.entries[file] = cached;
    } else {
      cacheDirty = true;
      moduleRecord = parseModule(sourceText, file);
      newCache.entries[file] = {
        hash: currentHash,
        moduleRecord,
        timestamp: Date.now(),
      };
    }

    modules.set(file, moduleRecord);

    if (moduleRecord.parseStatus === "parsed") {
      filesParsed += 1;
      // Quick framework detection for Layer 5 gating
      if (!hasFrameworkNodes && moduleRecord.ast) {
        walkAst(moduleRecord.ast, (rawNode) => {
          const node = rawNode as any;
          const isDecorator =
            !!node.decorators ||
            (Array.isArray(node.modifiers) &&
              node.modifiers.some((m: any) => m.type === "Decorator" || m.kind === "Decorator"));
          const isZodCall =
            node.type === "CallExpression" &&
            ((node.callee?.type === "MemberExpression" &&
              (node.callee.object?.name === "z" || node.callee.object?.name === "zod")) ||
              (node.callee?.type === "Identifier" &&
                (node.callee.name === "z" || node.callee.name.startsWith("zod"))));

          if (isDecorator || isZodCall) {
            hasFrameworkNodes = true;
            return true;
          }
        });
      }
    } else if (moduleRecord.parseStatus === "recovered") {
      filesRecovered += 1;
    } else {
      filesFallback += 1;
    }
  }

  if (Object.keys(cache.entries).length !== allSourceFiles.length) cacheDirty = true;

  let entryPoints = new Set<string>();
  // Tool configuration files are protected separately in the unreachable-file
  // pass below; they are not synthetic entry points and must not change the
  // public entry-point summary.
  // Existing public-entry behavior for conventional/package roots.
  const publicEntryPoints = new Set<string>();
  // Entries declared in package.json exports specifically describe public API.
  const publicApiEntryPoints = new Set<string>();
  // Private workspace barrels are locally reachable, but their re-exports do
  // not become external contracts without an actual consuming import.
  const privateWorkspaceEntryPoints = new Set<string>();
  const missingScriptTargets: Array<{
    scriptName: string;
    command: string;
    targetPath: string;
    manifestPath: string;
  }> = [];

  // 1. Explicit Entry Points
  if (entry.length > 0) {
    for (const pattern of entry) {
      const expanded = expandEntryPatterns(allSourceFiles, rootDir, [pattern]);
      for (const e of expanded) {
        entryPoints.add(path.normalize(e));
      }
    }
  }

  // 2. Conventional Entry Points (Public)
  // Helper to add patterns relative to a base directory
  const addPatterns = async (
    baseDir: string,
    relativeToRoot: string = "",
    isRoot: boolean = false,
  ) => {
    const expandBuildEntryToSourceCandidates = (entries: string[]) =>
      entries.flatMap((entry) => {
        if (entry.startsWith("dist/")) {
          const srcEntry = entry
            .replace("dist/", "src/")
            .replace(/\.js$/, ".ts")
            .replace(/\.jsx$/, ".tsx");
          return [entry, srcEntry];
        }
        return [entry];
      });

    const packageManifest = await readJsonFile<{ private?: boolean }>(
      path.join(baseDir, "package.json"),
    );
    const rawEntries = expandBuildEntryToSourceCandidates(
      await discoverPackageEntryPatterns(baseDir),
    );
    const binEntries = expandBuildEntryToSourceCandidates(
      await discoverPackageBinEntryPatterns(baseDir),
    );
    const publicExportEntries = expandBuildEntryToSourceCandidates(
      await discoverPackageExportEntryPatterns(baseDir),
    );
    const scriptTargets = await discoverPackageScriptTargets(baseDir);

    for (const scriptTarget of scriptTargets) {
      const adjustedPattern = relativeToRoot
        ? path.posix.join(relativeToRoot, scriptTarget.relativePath)
        : scriptTarget.relativePath;
      const requestedPattern = relativeToRoot
        ? path.posix.join(relativeToRoot, scriptTarget.requestedPath)
        : scriptTarget.requestedPath;
      if (!scriptTarget.exists) {
        missingScriptTargets.push({
          scriptName: scriptTarget.scriptName,
          command: scriptTarget.command,
          targetPath: requestedPattern,
          manifestPath: path.join(baseDir, "package.json"),
        });
        continue;
      }
      for (const scriptFile of expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern])) {
        entryPoints.add(path.normalize(scriptFile));
      }
    }

    for (const binPattern of binEntries) {
      const adjustedPattern =
        relativeToRoot && !binPattern.startsWith("/")
          ? path.posix.join(relativeToRoot, binPattern)
          : binPattern;
      for (const binFile of expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern])) {
        entryPoints.add(path.normalize(binFile));
      }
    }

    // An exports map declares package entry points that external consumers may
    // import. Analyze them as roots regardless of conventional-entry settings.
    for (const entryPattern of publicExportEntries) {
      const adjustedPattern =
        relativeToRoot && !entryPattern.startsWith("/")
          ? path.posix.join(relativeToRoot, entryPattern)
          : entryPattern;
      for (const entryFile of expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern])) {
        const normalized = path.normalize(entryFile);
        entryPoints.add(normalized);
        publicEntryPoints.add(normalized);
        if (packageManifest?.private === true && !isRoot) {
          privateWorkspaceEntryPoints.add(normalized);
        } else {
          publicApiEntryPoints.add(normalized);
        }
      }
    }

    for (const pattern of [...rawEntries, ...conventionalEntryPatterns()]) {
      const adjustedPattern =
        relativeToRoot && !pattern.startsWith("/")
          ? path.posix.join(relativeToRoot, pattern)
          : pattern;

      const expanded = expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern]);
      for (const e of expanded) {
        const normalized = path.normalize(e);
        if (isRoot && includeConventionalEntries) {
          entryPoints.add(normalized);
          publicEntryPoints.add(normalized);
        }
        // Workspace barrels are entry points even when private. Only
        // publishable packages enter `publicApiEntryPoints`, which controls
        // whether their re-exports propagate external-contract protection.
        if (!isRoot) {
          // Every workspace package entry is an analysis root. Keep the public
          // and private-contract bookkeeping separate from reachability: a
          // private package is still reachable through its package boundary.
          entryPoints.add(normalized);
          publicEntryPoints.add(normalized);
          if (packageManifest?.private === true) {
            privateWorkspaceEntryPoints.add(normalized);
          }
        }
      }
    }
  };

  // Root entries
  await addPatterns(rootDir, "", true);

  // Monorepo sub-package entries
  if (resolvedOptions.monorepo) {
    for (const pkg of resolvedOptions.monorepo.packageMap.values()) {
      const relativeToRoot = path.posix.relative(rootDir, pkg.location);
      await addPatterns(pkg.location, relativeToRoot, false);
    }
  }

  const findings: Finding[] = [];
  for (const diagnostic of packageJsonDiagnostics) {
    findings.push({
      rule: "parse-recovery",
      severity: packageJsonRecovered ? "warning" : "error",
      confidence: "high",
      message: `Invalid package.json: ${diagnostic.message} (${diagnostic.code}).`,
      file: relativeDisplayPath(rootDir, packageJsonPath),
      location: diagnostic.location,
      evidence: {
        kind: "json-parse",
        code: diagnostic.code,
        excerpt: diagnostic.excerpt,
        repairable: packageJsonRepairable,
      },
    });
  }
  for (const missing of missingScriptTargets) {
    findings.push({
      rule: "missing-script-target",
      severity: "error",
      confidence: "high",
      message: `Script '${missing.scriptName}' executes local Node target '${missing.targetPath}', but that path does not exist.`,
      file: missing.manifestPath,
      evidence: {
        script: missing.scriptName,
        command: missing.command,
        targetPath: missing.targetPath,
      },
    });
  }

  if (entryPoints.size === 0) {
    findings.push({
      rule: "no-entry-points",
      severity: "warning",
      confidence: "info",
      message: "No entry points found or configured. All files will be considered unreachable.",
      file: rootDir,
      evidence: {},
    });
  }

  const context = contextWithGraph(modules, entryPoints, resolvedOptions, publicApiEntryPoints);
  (context as any).publicEntryPoints = publicEntryPoints;
  context.publicApiEntryPoints = publicApiEntryPoints;
  context.semanticGraph = semanticGraph;
  context.symbolicContracts = new Map();

  // ── PLUGIN LIFECYCLE SYNC ────────────────────────────────────────────────
  // 1. Transfer marks from earlyContext (onProjectInit effects) to the final context
  for (const configFile of configuredConfigFiles) context.protectedConfigFiles.add(configFile);
  for (const configFile of earlyContext.protectedConfigFiles) {
    context.protectedConfigFiles.add(configFile);
  }
  for (const r of earlyContext.reachable) context.reachable.add(r);
  for (const e of earlyContext.entryPoints) {
    context.entryPoints.add(e);
    entryPoints.add(e);
  }
  for (const r of earlyContext.runtimeUsedFiles ?? []) context.runtimeUsedFiles?.add(r);
  for (const p of earlyContext.usedPackages) context.usedPackages.add(p);
  for (const e of earlyContext.usedExports) context.usedExports.add(e);
  for (const pl of earlyContext.enabledPlugins) context.enabledPlugins.add(pl);

  // 2. Run full plugin execution (File Hooks + AST Nodes + Analysis Complete)
  // We skip detection as it was already handled in earlyContext.
  const finalPluginFindings = await pluginEngine.run(context, { skipDetection: true });

  // 3. Combine findings from both runs (init-time + execution-time)
  const isCompilerLoaderDiagnostic = (finding: Finding): boolean =>
    finding.rule === "plugin-error" && finding.evidence?.pluginFile === "compiler-plugin.ts";
  findings.push(...pluginFindings.filter((finding) => !isCompilerLoaderDiagnostic(finding)));
  findings.push(...finalPluginFindings.filter((finding) => !isCompilerLoaderDiagnostic(finding)));

  // --- RE-CALCULATE REACHABILITY ---
  // Ensure that plugin marks (reachable files) are propagated through the graph
  const newReachability = calculateReachability(
    modules,
    context.reachable,
    resolvedOptions.ignoreUnknownImport,
  );
  for (const r of newReachability.reachable) context.reachable.add(r);
  for (const mr of newReachability.maybeReachable) context.maybeReachable.add(mr);
  calculateComponentReachability(context.components, context.reachable, context.maybeReachable);

  // Headless Living Graph Engine: Initial Ingestion
  for (const module of modules.values()) {
    const fileNode = {
      id: SemanticGraph.generateLei(module.id, "File"),
      contentHash: SemanticGraph.generateContentHash(module.sourceText),
      type: "File" as const,
      name: module.id,
      fileId: module.id,
      metadata: {},
      incomingReferences: [],
      outgoingReferences: [],
    };
    semanticGraph.addNode(fileNode);
  }

  // Gated Layer 5: Schema Alignment
  if (hasFrameworkNodes || resolvedOptions.externalContracts?.length) {
    await analyzeLayer5(context);
  }

  // Layer 6: Dependency & Boundary Engine.
  // Dependency auditing must not depend on monorepo, declaration-file, or
  // framework-contract detection: every workspace has a package manifest that
  // may declare packages which are no longer imported or used by scripts.
  // Contract revocation remains a no-op when the project contains no protected
  // exports, so running the layer unconditionally is safe.
  const layer6Findings = await analyzeLayer6(context);
  findings.push(...layer6Findings);

  // Layer 2: Control Flow Graph (CFG)
  const layer2Findings = analyzeLayer2(context);
  findings.push(...layer2Findings);

  // Phase 2: Layer 3 (Conditional Z3 SMT)
  if (!resolvedOptions.layers.skip3 && !resolvedOptions.layers.skipSmt) {
    const layer3Findings = await analyzeLayer3(context);
    findings.push(...layer3Findings);
  }

  // Phase 3: Layer 4 (node:vm sandbox)
  if (!resolvedOptions.layers.skip4) {
    const layer4Findings = await analyzeLayer4(context);
    findings.push(...layer4Findings);
  }

  // Phase 4: Layer 7 (Non-Standard Entry & Implicit Binding Engine)
  const layer7Findings = await analyzeLayer7(context);
  findings.push(...layer7Findings);

  // Phase 5: Headless Living Graph Engine (Symbolic Evaluation)
  const symbolicFindings = await symbolicEngine.evaluateContracts(context);
  findings.push(...symbolicFindings);

  // Add parser and resolution findings after all layers had a chance to resolve them
  for (const module of modules.values()) {
    for (const diagnostic of module.parseDiagnostics) {
      findings.push({
        rule: "parse-recovery",
        severity: diagnostic.recovered ? "info" : "error",
        confidence: diagnostic.recovered ? "low" : "high",
        message:
          "Parse " +
          (diagnostic.recovered ? "recovered with errors" : "failed") +
          ": " +
          diagnostic.message,
        file: diagnostic.file,
        ...(diagnostic.location && { location: diagnostic.location }),
        evidence: {},
      });
    }

    for (const edge of module.edges) {
      if (edge.resolution === "unresolved") {
        findings.push({
          rule: "unresolved-import",
          severity: "info",
          confidence: "high",
          message: "Unresolved import specifier: '" + edge.rawSpecifier + "'",
          file: edge.source,
          ...(edge.location && { location: edge.location }),
          evidence: {},
        });
      }
      if (
        !resolvedOptions.ignoreUnknownImport &&
        edge.kind === "unknown-dynamic" &&
        edge.resolution !== "resolved"
      ) {
        findings.push({
          rule: "unknown-dynamic-import",
          severity: "warning",
          confidence: "medium",
          message:
            "Unknown dynamic import pattern: '" +
            edge.rawSpecifier +
            "'. This may hide reachable code.",
          file: edge.source,
          ...(edge.location && { location: edge.location }),
          evidence: {},
        });
      }
    }
  }

  // Final Reporting Phase: Unused Exports & Unreachable Files
  const protectedExportPatterns = compileGlobs(resolvedOptions.protectedExportPatterns ?? []);
  const fullyUnusedPureExportModules = new Set<string>();
  if (resolvedOptions.reportUnusedExports) {
    const importUsage = buildImportUsage(modules);
    const packagePublicModules = new Set<string>(publicApiEntryPoints);
    let packagePublicModulesChanged = true;
    while (packagePublicModulesChanged) {
      packagePublicModulesChanged = false;
      for (const module of modules.values()) {
        if (!packagePublicModules.has(module.id)) continue;
        for (const edge of module.edges) {
          if (edge.kind !== "export-all" && edge.kind !== "export-from") continue;
          for (const targetId of edgeTargets(edge)) {
            if (!packagePublicModules.has(targetId)) {
              packagePublicModules.add(targetId);
              packagePublicModulesChanged = true;
            }
          }
        }
      }
    }
    for (const module of modules.values()) {
      const unreachableAndOptedIn =
        resolvedOptions.reportUnusedExportsInUnreachableFiles &&
        !context.reachable.has(module.id) &&
        !context.maybeReachable.has(module.id);
      if (
        (context.reachable.has(module.id) || unreachableAndOptedIn) &&
        !matchesAnyGlob(module.id, protectedExportPatterns, rootDir)
      ) {
        let allExportsUnused = module.exports.length > 0;
        for (const exp of module.exports) {
          if (exp.isExternalContract) {
            allExportsUnused = false;
            continue;
          }

          const isExportUsed =
            context.usedExports.has(`${module.id}:${exp.exportedAs}`) ||
            context.usedExports.has(`${module.id}:*`);

          let confidence: import("./types.js").Confidence = "high";
          if (context.maybeReachable.has(module.id)) confidence = "medium";
          if (context.hasReachableUnknownDynamicBoundary) confidence = "low";
          if (context.usedExportConfidence.get(`${module.id}:${exp.exportedAs}`) === "low")
            confidence = "low";

          if (context.hasReachableUnknownDynamicBoundary && isExportUsed) {
            allExportsUnused = false;
            continue;
          }

          let isEffectivelyUsed = isExportUsed;

          // PUBLIC ENTRY POINT & BARREL PROTECTION
          // PUBLIC ENTRY POINT & BARREL PROTECTION (symbol-aware)
          // Protect only the export that is actually re-exported through a
          // public barrel. The previous module-level check protected every
          // export in a re-exported JSX/TSX/SFC file, including unrelated
          // dead exports.
          const visited = new Set<string>();
          const checkPublicReachability = (
            moduleId: string,
            exportName: string,
            packageOnly = false,
          ): boolean => {
            const visitKey = `${packageOnly ? "package" : "workspace"}:${moduleId}:${exportName}`;
            if (visited.has(visitKey)) return false;
            visited.add(visitKey);

            if (
              !resolvedOptions.includeEntryExports &&
              (packageOnly ? packagePublicModules : publicEntryPoints).has(moduleId)
            )
              return true;

            const usage = importUsage.get(moduleId);
            if (!usage) return false;

            // A direct consumer can request a specific export from a public
            // workspace barrel, e.g. app -> ui -> Button. Protect only the
            // requested name (or a wildcard), not every export in the module.
            if (!usage.reExportOnly) {
              if (packageOnly) {
                const requested =
                  usage.wildcard ||
                  usage.names.has(exportName) ||
                  (exportName === "default" && usage.names.has("default"));
                return (
                  requested &&
                  Array.from(usage.consumers).some((consumerId) =>
                    packagePublicModules.has(consumerId),
                  )
                );
              }
              return (
                usage.wildcard ||
                usage.names.has(exportName) ||
                (exportName === "default" && usage.names.has("default"))
              );
            }

            const module = modules.get(moduleId);
            if (!module) return false;

            return Array.from(usage.consumers).some((consumerId) => {
              const consumer = modules.get(consumerId);
              if (!consumer) return false;

              for (const edge of consumer.edges) {
                if (!edgeTargets(edge).includes(moduleId)) continue;

                // A private workspace barrel exposes its own surface to local
                // consumers, but its re-export alone is not evidence that the
                // underlying source symbol is externally consumed.
                if (privateWorkspaceEntryPoints.has(consumerId)) {
                  continue;
                }
                if (edge.kind === "export-all" && exportName !== "default") {
                  if (checkPublicReachability(consumerId, exportName, packageOnly)) return true;
                }
                if (
                  edge.kind === "export-from" &&
                  (edge.importedNames.includes(exportName) || edge.importedNames.includes("*"))
                ) {
                  if (checkPublicReachability(consumerId, exportName, packageOnly)) return true;
                }
              }
              return false;
            });
          };

          if (checkPublicReachability(module.id, exp.exportedAs)) {
            isEffectivelyUsed = true;
          } else if (isExportUsed) {
            const usage = importUsage.get(module.id);
            if (usage && usage.reExportOnly) {
              const deepVisited = new Set<string>();
              const checkConsumer = (consumerId: string): boolean => {
                if (deepVisited.has(consumerId)) return false;
                deepVisited.add(consumerId);

                if (context.entryPoints.has(consumerId)) return true;
                if (publicEntryPoints.has(consumerId)) return true;

                const consumerUsage = importUsage.get(consumerId);
                if (!consumerUsage) return false;
                if (!consumerUsage.reExportOnly) return true;

                return Array.from(consumerUsage.consumers).some((c) => checkConsumer(c));
              };

              const hasRealConsumer = Array.from(usage.consumers).some((c) => checkConsumer(c));
              if (!hasRealConsumer) {
                isEffectivelyUsed = false;
              }
            }
          }

          if (isEffectivelyUsed) allExportsUnused = false;

          // A maybe-reachable module can be loaded through an unresolved dynamic
          // path (for example, a plugin name supplied via an environment variable).
          // Its exports are not statically provable as unused, so do not emit a
          // misleading unused-export finding for that module. Exact reachability
          // still reports genuinely unused exports as before.
          if (
            (!isEffectivelyUsed || unreachableAndOptedIn) &&
            exp.exportedAs !== "default" &&
            exp.exportedAs !== "*"
          ) {
            findings.push({
              rule: "unused-export",
              severity: "warning",
              confidence: confidence,
              message: "Export '" + exp.exportedAs + "' is never imported or referenced.",
              file: module.id,
              ...(exp.location && { location: exp.location }),
              evidence: { exportName: exp.exportedAs },
            });
          } else if (
            isEffectivelyUsed &&
            !checkPublicReachability(module.id, exp.exportedAs, true) &&
            exp.members &&
            exp.members.length > 0
          ) {
            for (const member of exp.members) {
              const memberKey = `${module.id}:${exp.exportedAs}:${member.name}`;
              const internalKey = `${module.id}:${exp.name}:${member.name}`;
              if (!context.usedMembers.has(memberKey) && !context.usedMembers.has(internalKey)) {
                findings.push({
                  rule: "unused-member",
                  severity: "warning",
                  confidence: confidence,
                  message: `Member '${member.name}' of export '${exp.exportedAs}' is never referenced.`,
                  file: module.id,
                  ...(member.location && { location: member.location }),
                  evidence: { exportName: exp.exportedAs, memberName: member.name },
                });
              }
            }
          }
        }
        if (
          allExportsUnused &&
          isPureExportOnlyModule(module) &&
          !context.runtimeUsedFiles?.has(module.id) &&
          !isConfigurationFile(module.id)
        ) {
          fullyUnusedPureExportModules.add(module.id);
        }
      }
    }
  }

  const unreachableFileIgnorePatterns = compileGlobs(
    resolvedOptions.unreachableFileIgnorePatterns ?? [],
  );
  for (const module of modules.values()) {
    if (
      !isConfigurationFile(module.id) &&
      !matchesAnyGlob(module.id, unreachableFileIgnorePatterns, rootDir) &&
      ((!context.reachable.has(module.id) && !context.maybeReachable.has(module.id)) ||
        fullyUnusedPureExportModules.has(module.id))
    ) {
      const fileComponent = context.components.find((c) => c.modules.includes(module.id));
      const isIsolatedComponent =
        fileComponent && !fileComponent.isReachable && !fileComponent.isMaybeReachable;
      findings.push({
        rule: "unreachable-file",
        severity: "warning",
        confidence: module.hasUnknownDynamicBoundary ? "medium" : "high",
        message: fullyUnusedPureExportModules.has(module.id)
          ? "File contains only exports that are unused and has no top-level runtime logic."
          : isIsolatedComponent
            ? `File is part of an isolated ${fileComponent.isCycle ? "cycle" : "component"} (#${fileComponent.id}) that is unreachable from any entry point.`
            : "File is not reachable from any entry point.",
        file: module.id,
        evidence: {
          entryPoints: [...context.entryPoints].map((p) => relativeDisplayPath(rootDir, p)),
          componentId: fileComponent?.id,
          componentSize: fileComponent?.modules.length,
          isCycle: fileComponent?.isCycle ?? false,
          reason: fullyUnusedPureExportModules.has(module.id)
            ? "all-exports-unused-and-no-top-level-runtime-logic"
            : undefined,
        },
      });
    }
  }

  // A file that is already proven unreachable will be removed as a whole by
  // the fixer. Member- and statement-level diagnostics inside it are therefore
  // redundant and misleading; keeping only unreachable-file makes the report
  // actionable and prevents follow-up edits against a file that will disappear.
  const unreachableFiles = new Set(
    findings
      .filter((finding) => finding.rule === "unreachable-file")
      .map((finding) => finding.file),
  );
  for (let index = findings.length - 1; index >= 0; index--) {
    const finding = findings[index];
    if (
      finding &&
      unreachableFiles.has(finding.file) &&
      (finding.rule === "unused-member" || finding.rule === "unreachable-statement") &&
      !(
        finding.rule === "unused-member" &&
        resolvedOptions.includeEntryMembers &&
        context.entryPoints.has(finding.file)
      )
    ) {
      findings.splice(index, 1);
    }
  }

  // A protected configuration file is still parsed, represented in the graph,
  // and available to plugins, but it must not produce any file-local finding.
  // Keep this universal final gate after every layer and plugin has emitted so
  // new file-local finding types inherit the same protection automatically.
  const isProtectedConfigFinding = (finding: Finding): boolean => {
    const file = finding.file;
    if (!file || typeof file !== "string") return false;
    const absoluteFile = normalizeAbsolute(
      path.isAbsolute(file) ? file : path.resolve(rootDir, file),
    );
    return (
      context.protectedConfigFiles.has(absoluteFile) ||
      matchesAnyGlob(absoluteFile, configuredConfigFilePatterns, rootDir)
    );
  };
  for (let index = findings.length - 1; index >= 0; index -= 1) {
    if (findings[index] && isProtectedConfigFinding(findings[index]!)) {
      findings.splice(index, 1);
    }
  }

  // Ignore means ignore the entire path, not only source files. In particular,
  // package.json and other metadata below test/fixtures directories must not
  // produce dependency, schema, or parse findings either.
  for (let index = findings.length - 1; index >= 0; index -= 1) {
    const finding = findings[index];
    if (finding && matchesAnyGlob(finding.file, compiledIgnorePatterns, rootDir)) {
      findings.splice(index, 1);
    }
  }

  // Regex fallback parsing is intentionally conservative: every finding whose
  // source file was recovered by regex is low confidence, regardless of which
  // analysis layer produced it.
  const regexFallbackFiles = new Set(
    [...modules.values()]
      .filter((module) => module.parserBackend === "regex" || module.parseStatus === "fallback")
      .map((module) => module.id),
  );
  for (const finding of findings) {
    if (regexFallbackFiles.has(finding.file)) {
      finding.confidence = "low";
    }
  }
  for (let index = findings.length - 1; index >= 0; index -= 1) {
    if (
      findings[index]?.rule === "plugin-error" &&
      findings[index]?.evidence?.pluginFile === "compiler-plugin.ts"
    ) {
      findings.splice(index, 1);
    }
  }

  const summary: AnalysisSummary = {
    filesDiscovered: allSourceFiles.length,
    filesParsed,
    filesRecovered,
    filesFallback,
    edges: [...modules.values()].reduce((sum, module) => sum + module.edges.length, 0),
    entryPoints: entryPoints.size,
    stronglyConnectedComponents: context.components.length,
    cycles: context.components.filter((c) => c.isCycle).length,
    findings: findings.length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };

  const modulesByStatus: Record<ModuleRecord["parseStatus"], number> = {
    parsed: 0,
    recovered: 0,
    fallback: 0,
  };
  let parserDiagnosticCount = 0;
  for (const module of modules.values()) {
    modulesByStatus[module.parseStatus] += 1;
    parserDiagnosticCount += module.parseDiagnostics.length;
  }
  const verboseJsonDebug = resolvedOptions.verbose && resolvedOptions.output === "json";

  const report: AnalysisReport = {
    version: VERSION,
    rootDir,
    entryPoints: [...entryPoints].map((p) => relativeDisplayPath(rootDir, p)),
    summary,
    usedPackages: [...context.usedPackages].sort(),
    findings: findings.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.location && b.location) {
        if (a.location.start.line !== b.location.start.line)
          return a.location.start.line - b.location.start.line;
        return a.location.start.column - b.location.start.column;
      }
      return 0;
    }),
    modules: [...modules.values()].map((module) => ({
      path: relativeDisplayPath(rootDir, module.id),
      parseStatus: module.parseStatus,
      parseDiagnostics: module.parseDiagnostics.map((diagnostic) => ({
        ...diagnostic,
        file: relativeDisplayPath(rootDir, diagnostic.file),
      })),
      exports: module.exports.map((e) => {
        const confidence = context.usedExportConfidence.get(`${module.id}:${e.exportedAs}`);
        const isUsed =
          context.usedExports.has(`${module.id}:${e.exportedAs}`) || confidence !== undefined;
        return {
          name: e.name,
          exportedAs: e.exportedAs,
          isUsed,
          isDefault: e.isDefault,
          isReExport: e.isReExport,
          isWildcard: e.isWildcard,
          isTypeOnly: e.isTypeOnly ?? false,
          isExternalContract: e.isExternalContract ?? false,
          ...(confidence !== undefined && { usageConfidence: confidence }),
        };
      }),
      edges: module.edges.map((edge) => ({
        kind: edge.kind,
        specifier: edge.rawSpecifier,
        ...(edge.target && { target: relativeDisplayPath(rootDir, edge.target) }),
        resolution: edge.resolution,
      })),
    })),
    components: context.components.map((c) => ({
      id: c.id,
      modules: c.modules.map((m) => relativeDisplayPath(rootDir, m)),
      isCycle: c.isCycle,
    })),
    ...(verboseJsonDebug && {
      debug: {
        json: {
          diagnostics: packageJsonDiagnostics.map((diagnostic) => ({
            file: relativeDisplayPath(rootDir, packageJsonPath),
            code: diagnostic.code,
            message: diagnostic.message,
            location: diagnostic.location,
            excerpt: diagnostic.excerpt,
            recovered: packageJsonRecovered,
            repairable: packageJsonRepairable,
          })),
        },
        parser: {
          modulesByStatus,
          diagnostics: parserDiagnosticCount,
        },
      },
    }),
  };

  // Support automated fixes
  if (resolvedOptions.fix) {
    const fixedCount = await runFixes(report, resolvedOptions.rootDir, resolvedOptions.fix);
    if (
      resolvedOptions.verbose ||
      (typeof resolvedOptions.fix === "object" && resolvedOptions.fix.dryRun)
    ) {
      console.error(`[Fixer] Applied ${fixedCount} fixes.`);
    }
  }

  // Persist the compact report only after all analysis layers have completed.
  newCache.version = "2.1";
  newCache.analysisKey = analysisKey;
  newCache.fileHashes = currentFileHashes;
  newCache.fileStats = currentFileStats;
  newCache.report = report;
  for (const [file, entry] of Object.entries(newCache.entries)) {
    const fileFindings = report.findings.filter((finding) => finding.file === file);
    // Store the complete per-file result. An explicit empty array distinguishes
    // a clean, analyzed file from a legacy entry without a cached result.
    entry.findings = fileFindings;
    entry.result = fileFindings.map((finding) => ({
      ...(finding.location?.start.line !== undefined && { line: finding.location.start.line }),
      rule: finding.rule,
      message: finding.message,
    }));
  }
  saveCache(resolvedOptions.rootDir, newCache);

  // Support external cache-to path
  if ((options as any).cacheTo) {
    try {
      const dir = path.dirname((options as any).cacheTo);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync((options as any).cacheTo, JSON.stringify(newCache, null, 2));
    } catch (e) {}
  }

  return report;
}

/**
 * Headless API: Cache Management
 */
export { exportCache, importCache } from "./cache.js";

/**
 * Headless API: Automated Fixes
 */
export { applyFixes } from "./fixer.js";

// Fix für CLI-Imports
export { exportCache as exportCacheAlias, importCache as importCacheAlias } from "./cache.js";

/**
 * Headless API: Configuration loading and resolution.
 */
export { DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config-loader.js";
export { defineConfig } from "./types.js";
