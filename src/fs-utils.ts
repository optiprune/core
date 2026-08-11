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
  extensions: string[] = [".ts", ".tsx", ".js", ".jsx", ".vue", ".svelte", ".astro", ".json"]
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
    .filter((entry) => entry.startsWith(".") || entry.startsWith("src/") || entry.startsWith("lib/"))
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
    "apps/**/*.ts",
    "apps/**/*.tsx",
    "apps/**/*.js",
    "apps/**/*.jsx",
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

export async function ingestTsConfigPaths(rootDir: string, configPath: string = "tsconfig.json"): Promise<{ paths: Map<string, string[]>, baseUrl: string | undefined }> {
  const pathAliases = new Map<string, string[]>();
  const fullTsconfigPath = isAbsolute(configPath) ? configPath : join(rootDir, configPath);

  const tsconfig = await readJsonFile<{
    extends?: string | string[];
    compilerOptions?: {
      baseUrl?: string;
      paths?: Record<string, string[]>;
    };
  }>(fullTsconfigPath);

  if (!tsconfig) return { paths: pathAliases, baseUrl: undefined };

  // 1. Handle inheritance (extends)
  if (tsconfig.extends) {
    const extensions = Array.isArray(tsconfig.extends) ? tsconfig.extends : [tsconfig.extends];
    for (const ext of extensions) {
      let extPath = ext;
      if (ext.startsWith(".")) {
        extPath = join(dirname(fullTsconfigPath), ext);
        if (!extPath.endsWith(".json")) extPath += ".json";
      } else {
        // Handle node_modules resolution for extends (simplified)
        extPath = join(rootDir, "node_modules", ext);
        if (!(await fileExists(extPath))) {
          if (await fileExists(extPath + ".json")) extPath += ".json";
          else if (await fileExists(join(extPath, "tsconfig.json"))) extPath = join(extPath, "tsconfig.json");
        }
      }
      
      const parentConfig = await ingestTsConfigPaths(rootDir, extPath);
      for (const [alias, targets] of parentConfig.paths.entries()) {
        pathAliases.set(alias, targets);
      }
    }
  }

  // 2. Base URL
  const baseUrl = tsconfig.compilerOptions?.baseUrl;

  // 3. Paths
  const paths = tsconfig.compilerOptions?.paths;
  if (paths && typeof paths === "object") {
    for (const [alias, targets] of Object.entries(paths)) {
      if (Array.isArray(targets)) {
        pathAliases.set(alias, targets);
      }
    }
  }

  return { paths: pathAliases, baseUrl };
}