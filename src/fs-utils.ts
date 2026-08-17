import { promises as fs } from "node:fs";
import {
  normalize,
  resolve,
  dirname,
  extname,
  relative as patheRelative,
  isAbsolute,
  join,
} from "pathe";

const SOURCE_EXTENSION_ALIASES = new Map<string, string[]>([
  [".js", [".ts", ".tsx", ".js", ".jsx"]],
  [".jsx", [".tsx", ".jsx"]],
  [".mjs", [".mts", ".mjs", ".ts", ".js"]],
  [".cjs", [".cts", ".cjs", ".ts", ".js"]],
  // Framework SFC aliases: bare specifiers without extension resolve to SFC files
  [".vue", [".vue"]],
  [".svelte", [".svelte"]],
  [".astro", [".astro"]],
  // Stylesheet imports are first-class module edges, not unresolved assets.
  [".css", [".css"]],
  [".scss", [".scss", ".sass"]],
  [".sass", [".sass", ".scss"]],
  [".less", [".less"]],
  [".styl", [".styl", ".stylus"]],
  [".stylus", [".stylus", ".styl"]],
]);

export const DEFAULT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  // Framework Single-File Component formats
  ".vue",
  ".svelte",
  ".astro",
  // First-class stylesheet formats
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".stylus",
];

export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/vendor/**",
];

export function normalizeCanonicalPath(filePath: string): string {
  if (!filePath) return "";
  let posixPath = filePath.replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(posixPath)) {
    posixPath = posixPath.charAt(0).toUpperCase() + posixPath.slice(1);
  }
  const normalized = normalize(posixPath);
  return normalized.length > 1 && normalized.endsWith("/")
    ? normalized.slice(0, -1)
    : normalized;
}

export function toPosix(value: string): string {
  return normalizeCanonicalPath(value);
}

export function normalizeAbsolute(value: string): string {
  return normalizeCanonicalPath(resolve(value));
}

export function pathInside(parent: string, candidate: string): boolean {
  const p = normalizeCanonicalPath(parent);
  const c = normalizeCanonicalPath(candidate);
  const relPath = patheRelative(p, c);
  return relPath === "" || (!relPath.startsWith("..") && !isAbsolute(relPath));
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

/**
 * Converts a glob pattern to a Regular Expression.
 * 
 * Improvements:
 * 1. If a pattern doesn't contain a slash, it's treated as a name match (matches anywhere).
 * 2. Handles ** correctly for recursive directory matching.
 * 3. Normalizes trailing slashes to match both files and directories.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, "/");
  
  // Standard glob behavior: 
  // 1. If it contains no slash (other than a trailing one), it matches anywhere.
  // 2. A trailing slash means it must be a directory.
  const hasInternalSlash = p.replace(/\/$/, "").includes("/");
  const isNameOnly = !hasInternalSlash;

  let source = "^";
  
  if (isNameOnly) {
    source += "(?:.*/)?";
  }

  const cleanPattern = p.replace(/\/$/, "");
  
  for (let index = 0; index < cleanPattern.length; index += 1) {
    const char = cleanPattern[index];
    const next = cleanPattern[index + 1];
    
    if (char === "*" && next === "*") {
      const after = cleanPattern[index + 2];
      if (after === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegex(char ?? "");
    }
  }
  
  // Match the file/directory itself OR anything inside it if it's a directory
  source += "(?:/.*)?$";
  
  return new RegExp(source);
}

export function compileGlobs(patterns: string[]): RegExp[] {
  return patterns.map(globToRegExp);
}

/**
 * Checks if a path matches any of the compiled glob patterns.
 * Automatically handles absolute paths by making them relative to root if possible.
 */
export function matchesAnyGlob(
  filePath: string, 
  compiledPatterns: RegExp[], 
  rootDir?: string
): boolean {
  let target = toPosix(filePath);
  
  if (rootDir) {
    const normalizedRoot = normalizeAbsolute(rootDir);
    if (target.startsWith(normalizedRoot)) {
      target = patheRelative(normalizedRoot, target);
    }
  }
  
  // Strip leading ./ for clean matching
  const normalized = toPosix(target).replace(/^\.\//, "");
  
  return compiledPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Unified ignore check used across the codebase.
 */
export function isIgnored(
  filePath: string, 
  ignorePatterns: string[] = [], 
  rootDir?: string
): boolean {
  if (!ignorePatterns || ignorePatterns.length === 0) return false;
  const compiled = compileGlobs(ignorePatterns);
  return matchesAnyGlob(filePath, compiled, rootDir);
}

export async function fileExists(candidate: string): Promise<boolean> {
  try {
    const status = await fs.stat(candidate);
    return status.isFile();
  } catch {
    return false;
  }
}

export async function directoryExists(candidate: string): Promise<boolean> {
  try {
    const status = await fs.stat(candidate);
    return status.isDirectory();
  } catch {
    return false;
  }
}

export async function discoverSourceFiles(
  rootDir: string,
  extensions: string[],
  compiledIgnorePatterns: RegExp[],
): Promise<string[]> {
  const discovered: string[] = [];
  const normalizedRoot = normalizeAbsolute(rootDir);

  async function walk(currentDirectory: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDirectory, { encoding: "utf8", withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absolute = join(currentDirectory, entry.name.toString());
      const relPath = toPosix(patheRelative(normalizedRoot, normalizeAbsolute(absolute)));
      const probe = entry.isDirectory() ? `${relPath}/` : relPath;
      if (matchesAnyGlob(probe, compiledIgnorePatterns)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && extensions.includes(extname(entry.name.toString()))) {
        discovered.push(normalizeAbsolute(absolute));
      }
    }
  }

  await walk(normalizedRoot);
  return discovered.sort((left, right) => left.localeCompare(right));
}

export function isLikelyLocalSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("file:") ||
    isAbsolute(specifier)
  );
}

export function removeQueryAndHash(specifier: string): string {
  return specifier.replace(/[?#].*$/, "");
}

/**
 * Resolves an import specifier against a set of known files.
 * Handles .js -> .ts / .tsx extension mapping.
 */
export function resolveLocalSpecifier(
  sourceFilePath: string,
  rawSpecifier: string,
  knownFiles: Set<string> | Map<string, unknown>,
  extensions: string[] = [
    ".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".astro",
    ".css", ".scss", ".sass", ".less", ".styl", ".stylus", ".json"
  ]
): string | undefined {
  const cleaned = removeQueryAndHash(rawSpecifier);
  if (!isLikelyLocalSpecifier(cleaned)) {
    return undefined;
  }

  const sourceDir = dirname(normalizeCanonicalPath(sourceFilePath));
  const absoluteBasePath = normalizeCanonicalPath(
    resolve(sourceDir, cleaned)
  );

  const existsInKnown = (p: string) =>
    knownFiles instanceof Set ? knownFiles.has(p) : knownFiles.has(p);

  // Strategy A: Exact match
  if (existsInKnown(absoluteBasePath)) {
    return absoluteBasePath;
  }

  // Strategy B: Try extension aliases (.js -> .ts/.tsx)
  const baseExtension = extname(absoluteBasePath);
  if (baseExtension) {
    const aliases = SOURCE_EXTENSION_ALIASES.get(baseExtension);
    if (aliases) {
      for (const alias of aliases) {
        const candidate = `${absoluteBasePath.slice(0, -baseExtension.length)}${alias}`;
        if (existsInKnown(candidate)) {
          return candidate;
        }
      }
    }
  }

  // Strategy C: Append extensions
  for (const ext of extensions) {
    const candidate = `${absoluteBasePath}${ext}`;
    if (existsInKnown(candidate)) {
      return candidate;
    }
  }

  // Strategy D: Search for index file
  for (const ext of extensions) {
    const candidate = `${absoluteBasePath}/index${ext}`;
    if (existsInKnown(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function candidateSpecifiers(fromFile: string, candidate: string): string[] {
  const from = normalizeCanonicalPath(fromFile);
  const target = normalizeCanonicalPath(candidate);
  
  const relPath = patheRelative(dirname(from), target);
  const withPrefix = relPath.startsWith(".") ? relPath : `./${relPath}`;
  
  const extension = extname(withPrefix);
  const withoutExtension = extension ? withPrefix.slice(0, -extension.length) : withPrefix;
  const aliases = extension ? SOURCE_EXTENSION_ALIASES.get(extension) ?? [extension] : [""];
  const mapped = aliases.map((alias) => `${withoutExtension}${alias}`);
  
  return [...new Set([withPrefix, withoutExtension, ...mapped])];
}

export function resolveDynamicPattern(
  fromFile: string,
  prefix: string,
  suffix: string,
  knownFiles: Set<string>,
): string[] {
  if (!isLikelyLocalSpecifier(prefix)) {
    return [];
  }
  const matches: string[] = [];
  for (const candidate of knownFiles) {
    const forms = candidateSpecifiers(fromFile, candidate);
    if (forms.some((form) => form.startsWith(prefix) && form.endsWith(suffix))) {
      matches.push(candidate);
    }
  }
  return matches.sort((left, right) => left.localeCompare(right));
}

export function expandEntryPatterns(
  sourceFiles: string[],
  rootDir: string,
  patterns: string[],
): string[] {
  const matches = new Set<string>();
  const normalizedRoot = normalizeAbsolute(rootDir);
  const normalizedSourceFiles = sourceFiles.map(f => normalizeAbsolute(f));

  for (const pattern of patterns) {
    // 1. Direct absolute or relative path resolution
    const direct = normalizeAbsolute(isAbsolute(pattern) ? pattern : resolve(rootDir, pattern));
    
    if (normalizedSourceFiles.includes(direct)) {
      matches.add(direct);
      continue;
    }

    // 2. Clean glob pattern (strip leading ./ or drive letter if relative to root)
    let p = toPosix(pattern);
    if (isAbsolute(p)) {
      p = patheRelative(normalizedRoot, p);
    }
    p = p.replace(/^\.\//, "");

    const matcher = globToRegExp(p);
    
    for (const sourceFile of normalizedSourceFiles) {
      // Stripping leading ./ from relPath ensures "^src\/..." regex matches cleanly
      const relPath = toPosix(patheRelative(normalizedRoot, sourceFile)).replace(/^\.\//, "");
      
      if (matcher.test(relPath)) {
        matches.add(sourceFile);
      }
    }
  }

  return [...matches].sort((left, right) => left.localeCompare(right));
}
export async function discoverPackageBinEntryPatterns(rootDir: string): Promise<string[]> {
  const packageFile = join(rootDir, "package.json");
  try {
    const packageJson = await readJsonFile<Record<string, unknown>>(packageFile);
    if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) return [];
    const entries = new Set<string>();
    if (typeof packageJson.bin === "string") entries.add(packageJson.bin);
    else if (packageJson.bin && typeof packageJson.bin === "object" && !Array.isArray(packageJson.bin)) {
      for (const target of Object.values(packageJson.bin as Record<string, unknown>)) {
        if (typeof target === "string") entries.add(target);
      }
    }
    return normalizePackageEntryPatterns(entries);
  } catch {
    return [];
  }
}

export interface PackageScriptTarget {
  scriptName: string;
  command: string;
  relativePath: string;
  exists: boolean;
}

/**
 * Finds local files executed by `node` in package.json scripts. This deliberately
 * handles only direct Node invocations such as `node scripts/task.mjs`, including
 * common Node flags and shell command chains. Arbitrary shell interpretation is
 * intentionally out of scope: only a concrete local file path is promoted to an
 * analyzer entry point.
 */
export async function discoverPackageScriptTargets(rootDir: string): Promise<PackageScriptTarget[]> {
  const packageFile = join(rootDir, "package.json");
  try {
    const packageJson = await readJsonFile<Record<string, unknown>>(packageFile);
    const scripts = packageJson?.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return [];

    const normalizedRoot = normalizeAbsolute(rootDir);
    const targets = new Map<string, PackageScriptTarget>();
    for (const [scriptName, command] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof command !== "string") continue;
      for (const target of extractNodeScriptTargets(command)) {
        if (target.includes("$") || target.includes("`")) continue;
        const absolutePath = normalizeAbsolute(resolve(normalizedRoot, target));
        const relativePath = toPosix(patheRelative(normalizedRoot, absolutePath));
        if (!relativePath || relativePath === ".." || relativePath.startsWith("../") || isAbsolute(relativePath)) continue;

        let exists = false;
        try {
          exists = (await fs.stat(absolutePath)).isFile();
        } catch {
          // Missing paths are returned so the caller can emit a focused diagnostic.
        }
        const key = `${scriptName}\u0000${relativePath}`;
        targets.set(key, { scriptName, command, relativePath, exists });
      }
    }
    return [...targets.values()];
  } catch {
    return [];
  }
}

function extractNodeScriptTargets(command: string): string[] {
  const tokens = tokenizeShellCommand(command);
  const targets: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const runner = tokens[index];
    const isNode = runner === "node" || runner === "nodejs";
    const isBun = runner === "bun";
    if (!isNode && !isBun) continue;

    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const token = tokens[cursor];
      if (!token) break;
      if (token === "&&" || token === "||" || token === ";" || token === "|") break;
      if (token === "-e" || token === "--eval" || token === "-p" || token === "--print") break;
      if (token === "--") {
        const candidate = tokens[cursor + 1];
        if (candidate && !candidate.startsWith("-") && (isNode || looksLikeScriptFile(candidate))) targets.push(candidate);
        break;
      }
      if (isBun && (token === "run" || token === "x" || token === "exec")) continue;
      if (token === "-r" || token === "--require" || token === "--loader" || token === "--import" || token === "--conditions" || token === "--experimental-loader") {
        cursor += 1;
        continue;
      }
      if (token.startsWith("-")) continue;
      if (isNode || looksLikeScriptFile(token)) targets.push(token);
      break;
    }
  }
  return targets;
}

function looksLikeScriptFile(token: string): boolean {
  return token.includes("/") || /\.(?:[cm]?[jt]sx?|json)$/i.test(token);
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  const push = () => { if (token) tokens.push(token); token = ""; };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (!character) continue;
    if (quote) {
      if (character === quote) quote = undefined;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; continue; }
    if (/\s/.test(character)) { push(); continue; }
    if (character === "&" || character === "|") {
      push();
      if (command[index + 1] === character) index += 1;
      tokens.push(character === "&" ? "&&" : "||");
      continue;
    }
    if (character === ";") { push(); tokens.push(";"); continue; }
    token += character;
  }
  push();
  return tokens;
}

export async function discoverPackageEntryPatterns(rootDir: string): Promise<string[]> {
  const packageFile = join(rootDir, "package.json");
  try {
    const packageJson = await readJsonFile<Record<string, unknown>>(packageFile);
    if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
      return [];
    }
    const entries = new Set<string>();
    for (const field of ["main", "module", "browser", "types", "typings"]) {
      if (typeof packageJson[field] === "string") {
        entries.add(packageJson[field] as string);
      }
    }
    if (typeof packageJson.bin === "string") {
      entries.add(packageJson.bin);
    } else if (packageJson.bin && typeof packageJson.bin === "object" && !Array.isArray(packageJson.bin)) {
      for (const target of Object.values(packageJson.bin as Record<string, unknown>)) {
        if (typeof target === "string") entries.add(target);
      }
    }
    collectPackageExportStrings(packageJson.exports, entries);
    return normalizePackageEntryPatterns(entries);
  } catch {
    return [];
  }
}

/**
 * Returns only source entry patterns exposed by package.json's exports map.
 * An exports map represents a package's public import surface, unlike legacy
 * metadata such as main or types which can describe implementation details.
 */
export async function discoverPackageExportEntryPatterns(rootDir: string): Promise<string[]> {
  const packageFile = join(rootDir, "package.json");
  try {
    const packageJson = await readJsonFile<Record<string, unknown>>(packageFile);
    if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
      return [];
    }
    const entries = new Set<string>();
    collectPackageExportStrings(packageJson.exports, entries);
    return normalizePackageEntryPatterns(entries);
  } catch {
    return [];
  }
}

function normalizePackageEntryPatterns(entries: Set<string>): string[] {
  return [...entries]
    .filter((entry) =>
      entry.startsWith(".") ||
      entry.startsWith("src/") ||
      entry.startsWith("lib/") ||
      entry.startsWith("dist/")
    )
    .map((entry) => entry.replace(/^\.\//, ""));
}

function collectPackageExportStrings(value: unknown, collected: Set<string>): void {
  if (typeof value === "string") {
    collected.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectPackageExportStrings(item, collected);
    }
  } else if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) {
      collectPackageExportStrings(nested, collected);
    }
  }
}

export function conventionalEntryPatterns(): string[] {
  return [
    "src/main.*",
    "src/index.*",
    "src/app.*",
    "src/App.*",
    "src/server.*",
    "src/cli.*",
    "app/**/*.ts",
    "app/**/*.tsx",
    "app/**/*.js",
    "app/**/*.jsx",
    "pages/**/*.ts",
    "pages/**/*.tsx",
    "pages/**/*.js",
    "pages/**/*.jsx",
  ];
}

export function normalizedConventionalEntryPatterns(): string[] {
  return [
    "src/main.*",
    "src/index.*",
    "src/app.*",
    "src/App.*",
    "src/server.*",
    "src/cli.*",
    "app/**/*.ts",
    "app/**/*.tsx",
    "app/**/*.js",
    "app/**/*.jsx",
    "pages/**/*.ts",
    "pages/**/*.tsx",
    "pages/**/*.js",
    "pages/**/*.jsx",
  ];
}

export async function readJsonFile<T>(candidate: string): Promise<T | undefined> {
  try {
    let rawContent = await fs.readFile(candidate, "utf8");
    
    // Strip UTF-8 BOM
    if (rawContent.charCodeAt(0) === 0xFEFF) {
      rawContent = rawContent.slice(1);
    }

    rawContent = rawContent.trim();

    try {
      // Strip comments for JSONC support (common in tsconfig.json)
      const stripped = rawContent
        .replace(/\/\/.*$/gm, "") // Strip single line comments
        .replace(/\/\*[\s\S]*?\*\//g, ""); // Strip multi-line comments
      return JSON.parse(stripped) as T;
    } catch {
      // Fallback for literal escaped strings in synthetic test fixtures
      const sanitized = rawContent
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t");
      return JSON.parse(sanitized) as T;
    }
  } catch {
    return undefined;
  }
}

export async function findNearestConfig(startDirectory: string): Promise<string | undefined> {
  let current = normalizeAbsolute(startDirectory);
  while (true) {
    const candidate = join(current, "optiprune.config.json");
    if (await fileExists(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

export function relativeDisplayPath(rootDir: string, candidate: string): string {
  const relPath = patheRelative(normalizeAbsolute(rootDir), normalizeAbsolute(candidate));
  return relPath || ".";
}

export async function rootLooksValid(rootDir: string): Promise<boolean> {
  return directoryExists(rootDir);
}

type TsConfigReference = string | { path?: string };

type TsConfigShape = {
  extends?: string | string[];
  references?: TsConfigReference[];
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
};

/**
 * Loads compiler path aliases from a solution tsconfig, its `extends` chain, and
 * its project references. Alias targets are normalized to absolute paths because
 * a referenced tsconfig can have a different base directory from the root config.
 */
export async function ingestTsConfigPaths(rootDir: string, configPath: string = "tsconfig.json"): Promise<{ paths: Map<string, string[]>, baseUrl: string | undefined }> {
  const pathAliases = new Map<string, string[]>();
  const visitedConfigs = new Set<string>();

  const resolveTsConfigFile = async (candidate: string): Promise<string> => {
    const normalizedCandidate = normalizeAbsolute(candidate);
    const candidates = normalizedCandidate.endsWith(".json")
      ? [normalizedCandidate]
      : [normalizedCandidate, `${normalizedCandidate}.json`, join(normalizedCandidate, "tsconfig.json")];
    for (const possibleConfig of candidates) {
      if (await fileExists(possibleConfig)) return possibleConfig;
    }
    return normalizedCandidate;
  };

  const loadConfig = async (candidate: string): Promise<string | undefined> => {
    const configFile = await resolveTsConfigFile(candidate);
    if (visitedConfigs.has(configFile)) return undefined;
    visitedConfigs.add(configFile);

    const tsconfig = await readJsonFile<TsConfigShape>(configFile);
    if (!tsconfig) return undefined;

    const configDirectory = dirname(configFile);
    let inheritedBaseUrl: string | undefined;

    // Inherited compiler options are loaded first, so this config can override them.
    for (const extension of tsconfig.extends ? (Array.isArray(tsconfig.extends) ? tsconfig.extends : [tsconfig.extends]) : []) {
      const extensionPath = extension.startsWith(".") || isAbsolute(extension)
        ? join(configDirectory, extension)
        : join(rootDir, "node_modules", extension);
      const parentBaseUrl = await loadConfig(extensionPath);
      if (parentBaseUrl) inheritedBaseUrl = parentBaseUrl;
    }

    // A solution tsconfig often keeps aliases in referenced app/library configs.
    // Their aliases are collected before local paths, preserving local overrides.
    for (const reference of tsconfig.references ?? []) {
      const referencePath = typeof reference === "string" ? reference : reference.path;
      if (referencePath) await loadConfig(join(configDirectory, referencePath));
    }

    const configuredBaseUrl = tsconfig.compilerOptions?.baseUrl;
    const effectiveBaseUrl = configuredBaseUrl
      ? normalizeAbsolute(resolve(configDirectory, configuredBaseUrl))
      : inheritedBaseUrl;
    const aliasBaseDirectory = effectiveBaseUrl ?? configDirectory;

    for (const [alias, targets] of Object.entries(tsconfig.compilerOptions?.paths ?? {})) {
      if (Array.isArray(targets)) {
        pathAliases.set(alias, targets.map((target) => normalizeAbsolute(resolve(aliasBaseDirectory, target))));
      }
    }

    return effectiveBaseUrl;
  };

  const discoverWorkspaceTsConfigs = async (): Promise<string[]> => {
    const ignoredDirectories = new Set([
      ".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache",
    ]);
    const discovered: string[] = [];

    const visit = async (directory: string): Promise<void> => {
      try {
        const entries = await fs.readdir(directory, { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
          const entryPath = join(directory, entry.name);
          if (entry.isDirectory()) {
            if (!ignoredDirectories.has(entry.name)) await visit(entryPath);
          } else if (entry.isFile() && entry.name === "tsconfig.json") {
            discovered.push(entryPath);
          }
        }
      } catch {
        return;
      }
    };

    await visit(rootDir);
    return discovered;
  };

  const initialConfigPath = isAbsolute(configPath) ? configPath : join(rootDir, configPath);
  const baseUrl = await loadConfig(initialConfigPath);

  // A workspace root need not carry a solution tsconfig. Load each local
  // tsconfig so aliases such as `@/*` can resolve from applications below it.
  for (const workspaceConfig of await discoverWorkspaceTsConfigs()) {
    await loadConfig(workspaceConfig);
  }

  return { paths: pathAliases, baseUrl };
}