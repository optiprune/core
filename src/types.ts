export type Confidence = "high" | "medium" | "low" | "info";
export type FailOn = Confidence | "none";
export type Severity = "error" | "warning" | "info";
export type ParseStatus = "parsed" | "recovered" | "fallback";
export type ParserBackend = "node" | "wasm" | "regex";
export type EdgeKind =
  | "import"
  | "export-from"
  | "export-all"
  | "require"
  | "dynamic-literal"
  | "dynamic-pattern"
  | "unknown-dynamic";
/** Output format for analysis results. */
export type OutputFormat = "terminal" | "json" | "sarif";

export interface Position {
  line: number;
  column: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface ParseDiagnostic {
  message: string;
  file: string;
  location?: Range;
  recovered: boolean;
}

export interface ExportMember {
  name: string;
  location?: Range;
}

export interface ExportRecord {
  name: string;
  exportedAs: string;
  location?: Range;
  isDefault: boolean;
  isReExport: boolean;
  isWildcard: boolean;
  isTypeOnly?: boolean;
  isExternalContract?: boolean; // Added for Layer 5: Schema Alignment
  localReferences?: string[]; // Added for Fix 3: Symbol Propagation
  members?: ExportMember[]; // Added for Member-Level Analysis
}

export interface DependencyEdge {
  source: string;
  rawSpecifier: string;
  kind: EdgeKind;
  target?: string;
  location?: Range;
  importedNames: string[];
  /** Local bindings in the same order as importedNames (e.g. `x as y` -> `y`). */
  importedLocals?: string[];
  dynamicPattern?: DynamicPattern;
  dynamicExpression?: string | undefined;
  resolution: "resolved" | "unresolved" | "external" | "unknown";
  isTypeOnly?: boolean;
}

export interface DynamicPattern {
  prefix: string;
  suffix: string;
  baseDirectory: string;
  candidates: string[];
}

export interface ModuleRecord {
  id: string;
  relativePath: string;
  parseStatus: ParseStatus;
  parseDiagnostics: ParseDiagnostic[];
  /** Backend used for this module: native Node binding, WASM, or regex recovery. */
  parserBackend?: ParserBackend;
  ast?: unknown;
  sourceText: string;
  exports: ExportRecord[];
  edges: DependencyEdge[];
  hasUnknownDynamicBoundary: boolean;
  hasParseError: boolean;
  hasUnresolvedCommonJsExports: boolean;
  scannedDirectories: string[];
  dynamicImportCandidates: DynamicImportCandidate[];
  localSymbolMap?: Record<string, string[]>; // Added for Fix 3: Internal symbol dependencies
  localTypeMap?: Record<string, string>; // Added for Member-Level Analysis: variableName -> typeName
  localReferences?: string[]; // Added for Fix: Track local references within the module
}

export interface WorkspacePackage {
  name: string;
  location: string;
  relativePath: string;
  manifestPath: string;
  dependencies: Set<string>;
  allDependencies: Set<string>;
}

export interface MonorepoGraph {
  rootPath: string;
  packageMap: Map<string, WorkspacePackage>;
  topologicalOrder: string[];
}

export interface StronglyConnectedComponent {
  id: number;
  modules: string[];
  isCycle: boolean;
  isReachable?: boolean;
  isMaybeReachable?: boolean;
}

export interface ConcolicVerificationResult {
  pathReached: boolean;
  executionTimeMs: number;
  logs: string[];
}

export interface CandidateBranch {
  file: string;
  line: number;
  instrumentedCode: string;
  seedInput: Record<string, any>;
}

export interface DynamicImportCandidate {
  file: string;
  line: number;
  column: number;
  expression: string; // The code to evaluate (e.g., path.join(pluginsDir, file))
  contextCode: string; // Surrounding code needed for evaluation
}

export interface Finding {
  rule:
    | "unreachable-file"
    | "unused-export"
    | "unused-member"
    | "unreachable-statement"
    | "constant-condition"
    | "contradictory-guard"
    | "schema-impossible-guard"
    | "parse-recovery"
    | "unresolved-import"
    | "unknown-dynamic-import"
    | "no-entry-points"
    | "unreachable-dynamic-path"
    | "protected-contract"
    | "missing-dependency"
    | "unused-dependency"
    | "unused-dev-dependency"
    | "non-existent-dependency"
    | "missing-script-target"
    | (string & {});
  severity: Severity;
  confidence: Confidence;
  message: string;
  file: string;
  location?: Range | undefined;
  evidence: Record<string, unknown>;
}

export interface AnalyzerOptions {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  reportUnusedExports?: boolean;
  /** Report unused exports from files that are also reported as unreachable. */
  reportUnusedExportsInUnreachableFiles?: boolean;
  schemaEnums?: Record<string, string[]>;
  externalContracts?: string[]; // Added for Layer 5: list of externally consumed symbol names
  failOn?: FailOn;
  /** @deprecated Use `output` instead. When true, equivalent to output: "json". */
  json?: boolean;
  /** Output format: "terminal" (default), "json", or "sarif". */
  output?: OutputFormat;
  includeConventionalEntries?: boolean;
  /** Report unused exports declared directly in entry files. */
  includeEntryExports?: boolean;
  /** Include dependency-cycle information in human-readable output. */
  cycles?: boolean;
  /** Ignore test files such as test.js, foo.test.ts, and __tests__ files. */
  ignoreTests?: boolean;
  /** Ignore dynamic import patterns and unknown dynamic imports for reachability. */
  ignoreUnknownImport?: boolean;
  skip3?: boolean;
  skip4?: boolean;
  verbose?: boolean;
  fix?: boolean | FixConfig;
  cacheFrom?: string;
  cacheTo?: string;
}

export type RuleSeverity = "error" | "warning" | "off";

/**
 * Plugin enable/disable configuration.
 * Keys are plugin names (as returned by `AnalyzerPlugin.name`).
 * Setting a value to `false` prevents the plugin from running even if its
 * `detect()` hook would return `true`.
 * Setting a value to `true` forces the plugin to run even if `detect()`
 * returns `false`.
 */
export type PluginsConfig = Record<string, boolean>;

export interface FixConfig {
  /**
   * Minimum confidence level to apply a fix.
   * - 'high': Only fix findings with high confidence.
   * - 'medium+': Fix findings with medium or high confidence.
   * - 'low' or 'low+': Fix findings with low, medium, or high confidence.
   * - 'all': Fix all findings regardless of confidence.
   */
  confidence?: 'high' | 'medium+' | 'low' | 'low+' | 'all';
  /**
   * Rules to fix. If omitted, only dependency and unreachable-file fixes are
   * enabled. Source-level rules are opt-in via `exports`; SFC exports and
   * unsupported syntax remain unchanged when they cannot be located safely.
   * Example: ['exports', 'files', 'dependencies', 'devDependencies']
   */
  rules?: string[];
  /**
   * Allow fixes that are considered unsafe or below the default safety boundary.
   */
  force?: boolean;
  /**
   * Whether to dry-run the fixes (log what would be fixed without changing files).
   */
  dryRun?: boolean;
}

export interface Config {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  /**
   * Dependencies (npm package names) that OptiPrune should never flag as
   * unused, regardless of whether they appear in import statements.
   */
  ignoreDependencies?: string[];
  externalContracts?: string[];
  reportUnusedExports?: boolean;
  /** Report unused exports from files that are also reported as unreachable. */
  reportUnusedExportsInUnreachableFiles?: boolean;
  includeConventionalEntries?: boolean;
  includeEntryExports?: boolean;
  cycles?: boolean;
  ignoreTests?: boolean;
  /** Ignore dynamic import patterns and unknown dynamic imports for reachability. */
  ignoreUnknownImport?: boolean;
  failOn?: FailOn;
  /** @deprecated Use `output` instead. */
  json?: boolean;
  /**
   * Output format for analysis results.
   * - `"terminal"` – human-readable coloured output (default)
   * - `"json"`     – machine-readable JSON to stdout
   * - `"sarif"`    – SARIF 2.1 JSON for IDE / CI integrations
   */
  output?: OutputFormat;
  verbose?: boolean;
  fix?: boolean | FixConfig;
  layers?: {
    smtTimeoutMs?: number;
    isolateMemoryLimitMb?: number;
    enableConcolicProof?: boolean;
    /** Skip Layer 3 (SMT / Z3 solver pass). */
    skip3?: boolean;
    /** Skip Layer 4 (node:vm sandbox pass). */
    skip4?: boolean;
  };
  rules?: Record<string, RuleSeverity>;
  /**
   * Explicit plugin enable/disable overrides.
   * Use the plugin's `name` string as the key.
   */
  plugins?: PluginsConfig;
}

export interface ResolvedOptions {
  rootDir: string;
  entry: string[];
  extensions: string[];
  ignore: string[];
  /** npm package names that are always treated as used. */
  ignoreDependencies: string[];
  reportUnusedExports: boolean;
  reportUnusedExportsInUnreachableFiles: boolean;
  schemaEnums: Record<string, string[]>;
  failOn: FailOn;
  /** @deprecated Derived from `output`. True when output === "json". */
  json: boolean;
  /** Resolved output format. */
  output: OutputFormat;
  includeConventionalEntries: boolean;
  includeEntryExports: boolean;
  cycles: boolean;
  ignoreTests: boolean;
  /** Ignore dynamic import patterns and unknown dynamic imports for reachability. */
  ignoreUnknownImport: boolean;
  monorepo?: MonorepoGraph;
  pathAliases: Map<string, string[]>;
  baseUrl?: string;
  externalContracts: string[];
  verbose: boolean;
  fix: boolean | FixConfig;
  cacheFrom?: string;
  cacheTo?: string;
  layers: {
    smtTimeoutMs: number;
    isolateMemoryLimitMb: number;
    enableConcolicProof: boolean;
    skip3: boolean;
    skip4: boolean;
  };
  rules: Record<string, RuleSeverity>;
  /** Resolved plugin overrides. */
  plugins: PluginsConfig;
  workspaceGlobs: string[];
  projectPatterns: string[];
  unreachableFileIgnorePatterns: string[];
  protectedExportPatterns: string[];
  repositoryType?: "single-package" | "workspace" | "monorepo";
  frameworks: string[];
}

export interface AnalysisSummary {
  filesDiscovered: number;
  filesParsed: number;
  filesRecovered: number;
  filesFallback: number;
  edges: number;
  entryPoints: number;
  stronglyConnectedComponents: number;
  cycles: number;
  findings: number;
  errors: number;
  warnings: number;
}

export interface AnalysisReport {
  version: string;
  rootDir: string;
  entryPoints: string[];
  summary: AnalysisSummary;
  findings: Finding[];
    modules: Array<{
    path: string;
    parseStatus: ParseStatus;
    exports: Array<{
      name: string;
      exportedAs: string;
      isUsed: boolean;
      isDefault: boolean;
      isReExport: boolean;
      isWildcard: boolean;
      isTypeOnly?: boolean;
      isExternalContract?: boolean;
      /** Present for exports retained because their file is exposed by package.json exports. */
      usageConfidence?: Confidence;
    }>;
    edges: Array<{
      kind: EdgeKind;
      specifier: string;
      target?: string;
      resolution: DependencyEdge["resolution"];
    }>;
  }>;
  components: Array<{
    id: number;
    modules: string[];
    isCycle: boolean;
  }>;
}

export interface AnalysisContext {
  options: ResolvedOptions;
  modules: Map<string, ModuleRecord>;
  entryPoints: Set<string>;
  reachable: Set<string>;
  maybeReachable: Set<string>;
  /** Files explicitly executed or consumed by a runtime/tool contract. */
  runtimeUsedFiles?: Set<string>;
  hasReachableUnknownDynamicBoundary: boolean;
  components: StronglyConnectedComponent[];
  usedExports: Set<string>;
  /** Confidence for exports retained through a public package entry point. */
  usedExportConfidence: Map<string, Confidence>;
  usedMembers: Set<string>; // Added for Member-Level Analysis
  candidateBranches: CandidateBranch[];
  dynamicImportCandidates: DynamicImportCandidate[];
  monorepo?: MonorepoGraph;
  semanticGraph?: any; // SemanticGraph instance
  symbolicContracts?: Map<string, any>;
  usedPackages: Set<string>; // Added for Plugin Priority
  enabledPlugins: Set<string>; // Added for Plugin Priority
  /** Package export-map entrypoints whose runtime members may be consumed externally. */
  publicApiEntryPoints?: ReadonlySet<string>;
}

export interface PluginAdapter {
  // Reading Abilities
  getAst(fileId: string): any;
  getSymbol(name: string, fileId: string): any;
  getType(node: any): string | undefined;
  getDependencies(fileId: string): string[];
  /** Whether a named export belongs to a package export-map entrypoint. */
  isPublicExport(fileId: string, exportName: string): boolean;
  getConfig(): ResolvedOptions;
  readFile(filename: string): Promise<string | null>;
  readJson(filename: string): Promise<any | null>;
  /** Check whether a directory (or file) exists relative to the project root. Useful for detecting tool directories like .husky, .git, etc. */
  folderExists(folderName: string): Promise<boolean>;
  /** Find project files by exact basename while excluding dependency and build output directories. */
  findFiles(fileNames: string[]): Promise<string[]>;
  /** Find project files matching static glob patterns with the engine's standard project filtering. */
  findFilesByGlob(patterns: string[]): Promise<string[]>;
  
  // Writing Abilities
  emitFinding(finding: Omit<Finding, "rule"> & { rule?: string }): void;
  markAsUsed(fileId: string, symbol?: string): void;
  markPackageAsUsed(packageName: string): void; // Added for Plugin Priority
  attachMetadata(node: any, key: string, value: any): void;
  setMonorepo(monorepo: MonorepoGraph): void;
  /** Add entry-point patterns discovered in a framework configuration. */
  addEntryPatterns(patterns: string[]): void;
  /** Add ignore patterns discovered in a framework configuration. */
  addIgnorePatterns(patterns: string[]): void;
  /** Add project-file patterns that define the framework's analysis scope. */
  addProjectPatterns(patterns: string[]): void;
  /** Exclude files from unreachable-file reports without removing them from analysis. */
  addUnreachableFileIgnorePatterns(patterns: string[]): void;
  /** Exclude dependencies that a framework configuration declares as externally managed. */
  addIgnoredDependencies(names: string[]): void;
  /** Exclude all exports in matching files from unused-export reports. */
  addProtectedExportPatterns(patterns: string[]): void;
  /** Protect externally consumed export names discovered in a configuration. */
  addExternalContracts(names: string[]): void;
  /** Register package/workspace globs supplied by package-manager or tooling configuration. */
  setWorkspaceGlobs(patterns: string[]): void;
  /** Persist the repository classification inferred by a plugin. */
  setRepoType(type: "single-package" | "workspace" | "monorepo"): void;
  /** Declare a verified framework for overlap-aware plugin behavior. */
  declareFramework(name: string): void;
  /** Check whether a verified framework has been declared. */
  hasFramework(name: string): boolean;
}

export interface PluginLifecycle {
  onProjectInit?(adapter: PluginAdapter): void | Promise<void>;
  onFileStart?(fileId: string, adapter: PluginAdapter): void | Promise<void>;
  onASTNode?(node: any, fileId: string, adapter: PluginAdapter, ancestors?: any[]): void;
  onAnalysisComplete?(adapter: PluginAdapter): void | Promise<void>;
}

export interface AnalyzerPlugin {
  name: string;
  version: string;
  enabled?: boolean; // Set by engine after detection
  detect?(adapter: PluginAdapter): Promise<boolean>;
  lifecycle: PluginLifecycle;
}

export const CONFIDENCE_RANK: Record<FailOn, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  none: -1, // A value for 'none' to allow comparison
};

export function defineConfig(config: Config): Config {
  return config;
}

export interface OptiPruneUserConfig {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  ignoreDependencies?: string[];
  externalContracts?: string[];
  reportUnusedExports?: boolean;
  reportUnusedExportsInUnreachableFiles?: boolean;
  includeConventionalEntries?: boolean;
  failOn?: "high" | "medium" | "low" | "info" | "none";
  layers?: {
    smtTimeoutMs?: number;
    isolateMemoryLimitMb?: number;
    enableConcolicProof?: boolean;
    skip3?: boolean;
    skip4?: boolean;
  };
  rules?: Record<string, "error" | "warning" | "off">;
  plugins?: PluginsConfig;
  verbose?: boolean;
  /** @deprecated Use `output` instead. */
  json?: boolean;
  output?: OutputFormat;
}
