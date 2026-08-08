export type Confidence = "high" | "medium" | "low" | "info";
export type FailOn = Confidence | "none";
export type Severity = "error" | "warning" | "info";
export type ParseStatus = "parsed" | "recovered" | "fallback";
export type EdgeKind =
  | "import"
  | "export-from"
  | "export-all"
  | "require"
  | "dynamic-literal"
  | "dynamic-pattern"
  | "unknown-dynamic";

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
  schemaEnums?: Record<string, string[]>;
  externalContracts?: string[]; // Added for Layer 5: list of externally consumed symbol names
  failOn?: FailOn;
  json?: boolean;
  includeConventionalEntries?: boolean;
  skip3?: boolean;
  skip4?: boolean;
  verbose?: boolean;
  fix?: boolean;
  cacheFrom?: string;
  cacheTo?: string;
}

export type RuleSeverity = "error" | "warning" | "off";

export interface Config {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  externalContracts?: string[];
  reportUnusedExports?: boolean;
  includeConventionalEntries?: boolean;
  failOn?: FailOn;
  json?: boolean;
  verbose?: boolean;
  fix?: boolean;
  layers?: {
    smtTimeoutMs?: number;
    isolateMemoryLimitMb?: number;
    enableConcolicProof?: boolean;
    skip3?: boolean;
    skip4?: boolean;
  };
  rules?: Record<string, RuleSeverity>;
}

export interface ResolvedOptions {
  rootDir: string;
  entry: string[];
  extensions: string[];
  ignore: string[];
  reportUnusedExports: boolean;
  schemaEnums: Record<string, string[]>;
  failOn: FailOn;
  json: boolean;
  includeConventionalEntries: boolean;
  monorepo?: MonorepoGraph;
  pathAliases: Map<string, string[]>;
  baseUrl?: string;
  externalContracts: string[];
  verbose: boolean;
  fix: boolean;
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
      isDefault: boolean;
      isReExport: boolean;
      isWildcard: boolean;
      isTypeOnly?: boolean;
      isExternalContract?: boolean;
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
  hasReachableUnknownDynamicBoundary: boolean;
  components: StronglyConnectedComponent[];
  usedExports: Set<string>;
  usedMembers: Set<string>; // Added for Member-Level Analysis
  candidateBranches: CandidateBranch[];
  dynamicImportCandidates: DynamicImportCandidate[];
  monorepo?: MonorepoGraph;
  semanticGraph?: any; // SemanticGraph instance
  symbolicContracts?: Map<string, any>;
  usedPackages: Set<string>; // Added for Plugin Priority
  enabledPlugins: Set<string>; // Added for Plugin Priority
}

export interface PluginAdapter {
  // Reading Abilities
  getAst(fileId: string): any;
  getSymbol(name: string, fileId: string): any;
  getType(node: any): string | undefined;
  getDependencies(fileId: string): string[];
  getConfig(): ResolvedOptions;
  readFile(filename: string): Promise<string | null>;
  readJson(filename: string): Promise<any | null>;
  /** Check whether a directory (or file) exists relative to the project root. Useful for detecting tool directories like .husky, .git, etc. */
  folderExists(folderName: string): Promise<boolean>;
  
  // Writing Abilities
  emitFinding(finding: Omit<Finding, "rule"> & { rule?: string }): void;
  markAsUsed(fileId: string, symbol?: string): void;
  markPackageAsUsed(packageName: string): void; // Added for Plugin Priority
  attachMetadata(node: any, key: string, value: any): void;
}

export interface PluginLifecycle {
  onProjectInit?(adapter: PluginAdapter): void | Promise<void>;
  onFileStart?(fileId: string, adapter: PluginAdapter): void | Promise<void>;
  onASTNode?(node: any, fileId: string, adapter: PluginAdapter): void;
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
