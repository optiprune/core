import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "pathe";
import { fileURLToPath } from "node:url";
import { parseModule, walkAst } from "./parser.js";
import { buildGraph, contextWithGraph, buildImportUsage, calculateReachability, calculateComponentReachability } from "./graph.js";
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
  discoverPackageExportEntryPatterns,
  discoverSourceFiles,
  expandEntryPatterns,
  ingestTsConfigPaths,
  normalizeAbsolute,
  readJsonFile,
  relativeDisplayPath,
  rootLooksValid,
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
const pkg = (await readJsonFile(path.join(__dirname, "..", "package.json"))) as { version?: string } | null;
const VERSION = pkg?.version ?? "1.8.2";

import { DEFAULT_CONFIG, loadConfig, mergeConfig } from "./config-loader.js";

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
  } as import('./types.js').Config);

  // Map top-level skip flags from CLI/Options to layers object
  if (options.skip3 !== undefined) merged.layers.skip3 = options.skip3;
  if (options.skip4 !== undefined) merged.layers.skip4 = options.skip4;

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

  return {
    ...merged,
    entry: merged.entry?.map((entry) => normalizeAbsolute(path.resolve(rootDir, entry))) ?? [],
    // DEFAULT_IGNORE is already baked into mergeConfig; avoid doubling it.
    ignore: merged.ignore,
    pathAliases,
    baseUrl,
  } as ResolvedOptions;
}
export function shouldFail(report: AnalysisReport, failOn: ResolvedOptions["failOn"]): boolean {
  if (failOn === "none") {
    return false;
  }
  const failThreshold = CONFIDENCE_RANK[failOn];
  return report.findings.some((f) => CONFIDENCE_RANK[f.confidence] >= failThreshold);
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

  const newCache = { version: "1.0", entries: {} as any };
  
  // Phase 1: Core Graph & AST (Instant)
  
  // Discover Monorepo Topology
  let hasMonorepo = false;
  try {
    resolvedOptions.monorepo = await buildMonorepoTopology(resolvedOptions.rootDir);
    hasMonorepo = !!resolvedOptions.monorepo;
  } catch (e) {
    // console.error(`[Monorepo] Discovery failed: ${e}`);
  }

  const { rootDir } = resolvedOptions;

  if (!(await rootLooksValid(rootDir))) {
    throw new Error(`Root directory does not exist: ${rootDir}`);
  }

  // ── RUN PLUGIN ENGINE INIT BEFORE FILE DISCOVERY ───────────────────────────
  // Initialize early context and run PluginEngine so CustomConfigPlugin can populate
  // resolvedOptions.ignore / entry / failOn BEFORE discoverSourceFiles is called.
  const initialModules = new Map<string, ModuleRecord>();
  const initialEntryPoints = new Set<string>();
  const earlyContext = contextWithGraph(initialModules, initialEntryPoints, resolvedOptions, new Set());

  const pluginEngine = new PluginEngine();
  const pluginFindings = await pluginEngine.run(earlyContext);

  // Re-read configuration options after plugin initialization
  const { extensions, ignore, entry, includeConventionalEntries } = resolvedOptions;
  const compiledIgnorePatterns = compileGlobs(ignore);

  const allSourceFiles = await discoverSourceFiles(rootDir, extensions, compiledIgnorePatterns);
  const modules = new Map<string, ModuleRecord>();
  const semanticGraph = new SemanticGraph();
  const topologyManager = new TopologyManager(semanticGraph);
  const symbolicEngine = new SymbolicEngine(semanticGraph);

  let filesParsed = 0;
  let filesRecovered = 0;
  let filesFallback = 0;
  let hasFrameworkNodes = false;

  for (const file of allSourceFiles) {
    let rawText: string;
    try {
      // BOM-safe file reader to prevent Babel/TS AST parse recovery warnings
      rawText = await fsp.readFile(file, "utf8");
    } catch (e: any) {
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const sourceText = rawText.charCodeAt(0) === 0xFEFF ? rawText.slice(1) : rawText;

    const currentHash = getFileHash(sourceText);
    
    let moduleRecord: ModuleRecord;
    const cached = cache.entries[file];
    
    if (cached && isCacheValid(cached, sourceText)) {
      moduleRecord = cached.moduleRecord;
      newCache.entries[file] = cached;
    } else {
      moduleRecord = parseModule(sourceText, file);
      newCache.entries[file] = {
        hash: currentHash,
        moduleRecord,
        timestamp: Date.now()
      };
    }
    
    modules.set(file, moduleRecord);
    
    if (moduleRecord.parseStatus === "parsed") {
      filesParsed += 1;
      // Quick framework detection for Layer 5 gating
      if (!hasFrameworkNodes && moduleRecord.ast) {
        walkAst(moduleRecord.ast, (rawNode) => {
          const node = rawNode as any;
          const isDecorator = !!node.decorators || (Array.isArray(node.modifiers) && node.modifiers.some((m: any) => m.type === 'Decorator' || m.kind === 'Decorator'));
          const isZodCall = node.type === "CallExpression" && (
            (node.callee?.type === "MemberExpression" && (node.callee.object?.name === "z" || node.callee.object?.name === "zod")) ||
            (node.callee?.type === "Identifier" && (node.callee.name === "z" || node.callee.name.startsWith("zod")))
          );

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
  
  saveCache(resolvedOptions.rootDir, newCache);

  let entryPoints = new Set<string>();
  // Existing public-entry behavior for conventional/package roots.
  const publicEntryPoints = new Set<string>();
  // Entries declared in package.json exports specifically describe public API.
  const publicApiEntryPoints = new Set<string>();

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
  const addPatterns = async (baseDir: string, relativeToRoot: string = "", isRoot: boolean = false) => {
    const expandBuildEntryToSourceCandidates = (entries: string[]) => entries.flatMap(entry => {
      if (entry.startsWith('dist/')) {
        const srcEntry = entry.replace('dist/', 'src/').replace(/\.js$/, '.ts').replace(/\.jsx$/, '.tsx');
        return [entry, srcEntry];
      }
      return [entry];
    });

    const rawEntries = expandBuildEntryToSourceCandidates(await discoverPackageEntryPatterns(baseDir));
    const publicExportEntries = expandBuildEntryToSourceCandidates(await discoverPackageExportEntryPatterns(baseDir));

    // An exports map declares package entry points that external consumers may
    // import. Analyze them as roots regardless of conventional-entry settings.
    for (const entryPattern of publicExportEntries) {
      const adjustedPattern = (relativeToRoot && !entryPattern.startsWith('/'))
        ? path.posix.join(relativeToRoot, entryPattern)
        : entryPattern;
      for (const entryFile of expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern])) {
        const normalized = path.normalize(entryFile);
        entryPoints.add(normalized);
        publicEntryPoints.add(normalized);
        publicApiEntryPoints.add(normalized);
      }
    }

    for (const pattern of [...rawEntries, ...conventionalEntryPatterns()]) {
      const adjustedPattern = (relativeToRoot && !pattern.startsWith('/')) 
        ? path.posix.join(relativeToRoot, pattern) 
        : pattern;
      
      const expanded = expandEntryPatterns(allSourceFiles, rootDir, [adjustedPattern]);
      for (const e of expanded) {
        const normalized = path.normalize(e);
        if (isRoot && includeConventionalEntries) {
          entryPoints.add(normalized);
          publicEntryPoints.add(normalized);
        }
        // Monorepo package entries are ALWAYS publicEntryPoints to protect their API
        if (!isRoot) {
          publicEntryPoints.add(normalized);
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
  context.semanticGraph = semanticGraph;
  context.symbolicContracts = new Map();

  // Re-run file start hooks for all parsed modules
  for (const module of modules.values()) {
    if (!module.ast) continue;
    for (const plugin of (pluginEngine as any).plugins) {
      if (plugin.enabled && plugin.lifecycle.onFileStart) {
        try {
          await plugin.lifecycle.onFileStart(module.id, (pluginEngine as any).createAdapter(context));
        } catch (err) {}
      }
    }
  }

  // --- RE-CALCULATE REACHABILITY ---
  const newReachability = calculateReachability(modules, context.reachable);
  for (const r of newReachability.reachable) context.reachable.add(r);
  for (const mr of newReachability.maybeReachable) context.maybeReachable.add(mr);
  calculateComponentReachability(context.components, context.reachable, context.maybeReachable);

  findings.push(...pluginFindings);

  // Headless Living Graph Engine: Initial Ingestion
  for (const module of modules.values()) {
    const fileNode = {
      id: SemanticGraph.generateLei(module.id, 'File'),
      contentHash: SemanticGraph.generateContentHash(module.sourceText),
      type: 'File' as const,
      name: module.id,
      fileId: module.id,
      metadata: {},
      incomingReferences: [],
      outgoingReferences: []
    };
    semanticGraph.addNode(fileNode);
  }

  // Gated Layer 5: Schema Alignment
  if (hasFrameworkNodes || resolvedOptions.externalContracts?.length) {
    await analyzeLayer5(context);
  }
  
  // Gated Layer 6: Dependency & Boundary Engine
  if (hasMonorepo || allSourceFiles.some(f => f.endsWith('.d.ts'))) {
    const layer6Findings = await analyzeLayer6(context);
    findings.push(...layer6Findings);
  }

  // Layer 2: Control Flow Graph (CFG)
  const layer2Findings = analyzeLayer2(context);
  findings.push(...layer2Findings);

  // Phase 2: Layer 3 (Conditional Z3 SMT)
  if (!resolvedOptions.layers.skip3) {
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
        message: "Parse " + (diagnostic.recovered ? "recovered with errors" : "failed") + ": " + diagnostic.message,
        file: diagnostic.file,
        ...(diagnostic.location && { location: diagnostic.location }),
        evidence: {},
      });
    }

    for (const edge of module.edges) {
      if (edge.resolution === "unresolved") {
        findings.push({
          rule: "unresolved-import",
          severity: "warning",
          confidence: "high",
          message: "Unresolved import specifier: '" + edge.rawSpecifier + "'",
          file: edge.source,
          ...(edge.location && { location: edge.location }),
          evidence: {},
        });
      }
      if (edge.kind === "unknown-dynamic" && edge.resolution !== "resolved") {
        findings.push({
          rule: "unknown-dynamic-import",
          severity: "warning",
          confidence: "medium",
          message: "Unknown dynamic import pattern: '" + edge.rawSpecifier + "'. This may hide reachable code.",
          file: edge.source,
          ...(edge.location && { location: edge.location }),
          evidence: {},
        });
      }
    }
  }

  // Final Reporting Phase: Unused Exports & Unreachable Files
  if (resolvedOptions.reportUnusedExports) {
    const importUsage = buildImportUsage(modules);
    for (const module of modules.values()) {
      if (context.reachable.has(module.id) || context.maybeReachable.has(module.id)) {
        for (const exp of module.exports) {
          if (exp.isExternalContract) continue;

          const isExportUsed = context.usedExports.has(`${module.id}:${exp.exportedAs}`);
          
          let confidence: import('./types.js').Confidence = "high";
          if (context.maybeReachable.has(module.id)) confidence = "medium";
          if (context.hasReachableUnknownDynamicBoundary) confidence = "low";
          if (context.usedExportConfidence.get(`${module.id}:${exp.exportedAs}`) === "low") confidence = "low";

          if (context.hasReachableUnknownDynamicBoundary && isExportUsed) continue;
          
          let isEffectivelyUsed = isExportUsed;
          
          // PUBLIC ENTRY POINT & BARREL PROTECTION
          const visited = new Set<string>();
          const checkPublicReachability = (moduleId: string): boolean => {
            if (visited.has(moduleId)) return false;
            visited.add(moduleId);
            
            if (publicEntryPoints.has(moduleId)) return true;
            
            const usage = importUsage.get(moduleId);
            if (!usage || !usage.reExportOnly) return false;
            
            return Array.from(usage.consumers).some(c => checkPublicReachability(c));
          };

          if (checkPublicReachability(module.id)) {
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
                
                return Array.from(consumerUsage.consumers).some(c => checkConsumer(c));
              };
              
              const hasRealConsumer = Array.from(usage.consumers).some(c => checkConsumer(c));
              if (!hasRealConsumer) {
                isEffectivelyUsed = false;
              }
            }
          }

          if (!isEffectivelyUsed && exp.exportedAs !== "default" && exp.exportedAs !== "*") {
            findings.push({
              rule: "unused-export",
              severity: "warning",
              confidence: confidence,
              message: "Export '" + exp.exportedAs + "' is never imported or referenced.",
              file: module.id,
              ...(exp.location && { location: exp.location }),
              evidence: { exportName: exp.exportedAs },
            });
          } else if (isEffectivelyUsed && exp.members && exp.members.length > 0) {
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
      }
    }
  }

  for (const module of modules.values()) {
    if (!context.reachable.has(module.id) && !context.maybeReachable.has(module.id)) {
      const fileComponent = context.components.find((c) => c.modules.includes(module.id));
      const isIsolatedComponent = fileComponent && !fileComponent.isReachable && !fileComponent.isMaybeReachable;
      findings.push({
        rule: "unreachable-file",
        severity: "warning",
        confidence: module.hasUnknownDynamicBoundary ? "medium" : "high",
        message: isIsolatedComponent
          ? `File is part of an isolated ${fileComponent.isCycle ? 'cycle' : 'component'} (#${fileComponent.id}) that is unreachable from any entry point.`
          : "File is not reachable from any entry point.",
        file: module.id,
        evidence: {
          entryPoints: [...context.entryPoints].map((p) => relativeDisplayPath(rootDir, p)),
          componentId: fileComponent?.id,
          componentSize: fileComponent?.modules.length,
          isCycle: fileComponent?.isCycle ?? false,
        },
      });
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

  const report: AnalysisReport = {
    version: VERSION,
    rootDir,
    entryPoints: [...entryPoints].map((p) => relativeDisplayPath(rootDir, p)),
    summary,
    findings: findings.sort((a, b) => {
      if (a.file !== b.file) return a.file.localeCompare(b.file);
      if (a.location && b.location) {
        if (a.location.start.line !== b.location.start.line) return a.location.start.line - b.location.start.line;
        return a.location.start.column - b.location.start.column;
      }
      return 0;
    }),
    modules: [...modules.values()].map((module) => ({
      path: relativeDisplayPath(rootDir, module.id),
      parseStatus: module.parseStatus,
      exports: module.exports.map((e) => {
        const confidence = context.usedExportConfidence.get(`${module.id}:${e.exportedAs}`);
        const isUsed = context.usedExports.has(`${module.id}:${e.exportedAs}`) || confidence !== undefined;
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
  };

  // Support automated fixes
  if ((options as any).fix) {
    await applyFixes(report);
  }

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
export { exportCache, importCache } from './cache.js';

/**
 * Headless API: Automated Fixes
 */
export async function applyFixes(report: AnalysisReport): Promise<number> {
  let fixedCount = 0;
  // Group findings by file to minimize FS operations
  const findingsByFile = new Map<string, Finding[]>();
  for (const finding of report.findings) {
    if (finding.rule === "unused-export" && finding.location) {
      const list = findingsByFile.get(finding.file) || [];
      list.push(finding);
      findingsByFile.set(finding.file, list);
    }
  }

  for (const [file, findings] of findingsByFile.entries()) {
    try {
      if (!fs.existsSync(file)) continue;
      let content = fs.readFileSync(file, "utf-8");
      
      // Sort findings in reverse order of their location to avoid offset issues
      const sortedFindings = [...findings].sort((a, b) => {
        return (b.location?.start.line ?? 0) - (a.location?.start.line ?? 0);
      });

      let lines = content.split("\n");
      for (const finding of sortedFindings) {
        const exportName = finding.evidence.exportName as string;
        // Simple regex to remove 'export const name = ...' or 'export function name...'
        const lineIdx = finding.location!.start.line - 1;
        const line = lines[lineIdx];
        
        if (line && line.includes(`export `) && line.includes(exportName)) {
          if (line.trim().startsWith(`export const ${exportName}`) || 
              line.trim().startsWith(`export function ${exportName}`) ||
              line.trim().startsWith(`export let ${exportName}`) ||
              line.trim().startsWith(`export var ${exportName}`)) {
            lines[lineIdx] = line.replace("export ", "");
            fixedCount++;
          }
        }
      }
      
      fs.writeFileSync(file, lines.join("\n"));
    } catch (e) {
      console.error(`[Fix Engine] Failed to apply fixes to ${file}:`, e);
    }
  }
  return fixedCount;
}

// Fix für CLI-Imports
export { exportCache as exportCacheAlias, importCache as importCacheAlias } from './cache.js';
