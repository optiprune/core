/**
 * source-mapping.ts
 *
 * Reverse mapping from compiled build artifacts back to the source files they
 * were generated from.
 *
 * A project that compiles `src/**` into `dist/**` is usually analyzed by its
 * source files, but manifests, package scripts and consumers often point at the
 * build output (`dist/index.js`, `../dist/index.jsx`, `dist/*.js`). Without a
 * reverse mapping those references cannot be tied back to the source module, so
 * the real entry point stays unreachable and its exports are reported as
 * unused.
 *
 * The mapper is deliberately explicit about three things that are easy to get
 * wrong:
 *
 *   1. The output extension may be `.jsx`/`.tsx`, not only `.js`/`.ts`. A
 *      project that emits `.jsx` (for example `jsx: "preserve"`) previously
 *      aborted the mapping early and left `dist/index.jsx` unmapped.
 *   2. `outDir`/`rootDir` from `tsconfig` define the directory translation
 *      instead of a hardcoded `dist/` -> `src/` string replacement.
 *   3. A project may compile a non-standard extension (`.foo`, `.mdx`,
 *      `.svelte`, ...) into `.js`. Those compiler extensions are probed after
 *      the standard source extensions so a custom compiler is never able to
 *      shadow a real TypeScript source file.
 */

import { promises as fs } from "node:fs";
import { dirname, isAbsolute, join, resolve, relative as patheRelative } from "pathe";
import {
  normalizeAbsolute,
  normalizeCanonicalPath,
  pathInside,
  readJsonFile,
  toPosix,
} from "./fs-utils.js";

/**
 * Matches every extension a compiler can emit for a JavaScript/TypeScript
 * source file, including the JSX variants and declaration files.
 *
 * The trailing `x?` is the important part: `.jsx` and `.tsx` must map back to
 * their source like `.js` and `.ts` do.
 */
export const OUTPUT_EXTENSION_PATTERN = /(\.d)?\.(m|c)?(j|t)sx?$/i;

/** Standard source extensions, probed before any custom compiler extension. */
export const STANDARD_SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

/**
 * Extensions that are never a compiled JavaScript/TypeScript source file. They
 * may be analyzable modules, but a `.js` build artifact is not generated from a
 * stylesheet, so they must not be probed as source candidates.
 */
const NON_COMPILED_SOURCE_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".stylus",
  ".json",
  ".jsonc",
  ".d.ts",
]);

/**
 * Extension flavour preference. A compiled `.jsx` artifact most plausibly came
 * from a `.tsx` source and a `.js` artifact from a `.ts` source, so the matching
 * flavour is probed before the remaining source extensions. This keeps
 * `dist/index.jsx` -> `src/index.tsx` stable even when both `src/index.ts` and
 * `src/index.tsx` exist.
 */
const EXTENSION_FLAVOURS: Record<string, string[]> = {
  ".js": [".ts", ".js", ".tsx", ".jsx", ".mts", ".mjs", ".cts", ".cjs"],
  ".jsx": [".tsx", ".jsx", ".ts", ".js"],
  ".mjs": [".mts", ".mjs", ".ts", ".js"],
  ".cjs": [".cts", ".cjs", ".ts", ".js"],
  ".ts": [".ts", ".tsx"],
  ".tsx": [".tsx", ".ts"],
  ".mts": [".mts", ".mjs", ".ts", ".js"],
  ".cts": [".cts", ".cjs", ".ts", ".js"],
};

export interface SourceMapping {
  /** Absolute source directory the build output is generated from. */
  srcDir: string;
  /** Absolute build output directory. */
  outDir: string;
  /** Standard source extensions, probed first. */
  sourceExtensions: string[];
  /** Additional compiler-provided extensions, probed after the standard ones. */
  compilerExtensions: string[];
}

/** Explicit user configuration for source mapping. */
export interface SourceMappingConfigInput {
  /** Source directory, relative to the project root or absolute. */
  srcDir?: string;
  /** Build output directory, relative to the project root or absolute. */
  outDir?: string;
  /** Overrides the standard source extension list. */
  sourceExtensions?: string[];
  /** Extensions handled by a custom compiler, e.g. `.foo`, `.mdx`, `.svelte`. */
  compilerExtensions?: string[];
}

export interface SourceMappingLoadOptions {
  /**
   * Extensions the analyzer treats as compilable source. In Knip terms these
   * are the extensions of every registered compiler; a project that compiles
   * `.foo` files declares `.foo` here (or via `sourceMapping.compilerExtensions`).
   */
  extensions?: string[];
  /** Explicit configuration overrides. */
  sourceMapping?: SourceMappingConfigInput;
}

/** Normalize an extension to a lowercase, dot-prefixed form. */
export function normalizeSourceExtension(extension: string): string | undefined {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) return undefined;
  const withDot = trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
  if (withDot === "." || NON_COMPILED_SOURCE_EXTENSIONS.has(withDot)) return undefined;
  return withDot;
}

/**
 * Strips the compiled output extension from a file path, preserving declaration
 * and module-format suffixes (`.d.ts`, `.mjs`, `.cjs`, `.jsx`, ...).
 */
export function stripOutputExtension(filePath: string): string | undefined {
  const match = OUTPUT_EXTENSION_PATTERN.exec(filePath);
  if (!match) return undefined;
  return filePath.slice(0, filePath.length - match[0].length);
}

/** Ordered candidate extensions for one compiled output file. */
export function orderedSourceExtensions(outputPath: string, mapping: SourceMapping): string[] {
  const match = OUTPUT_EXTENSION_PATTERN.exec(outputPath);
  const flavour = match ? (EXTENSION_FLAVOURS[match[0].toLowerCase()] ?? []) : [];
  return [...new Set([...flavour, ...mapping.sourceExtensions, ...mapping.compilerExtensions])];
}

/**
 * Maps a concrete build artifact (or a glob pattern rooted in `outDir`) to the
 * candidate source specifiers it may have been generated from.
 *
 * Returns an empty array when the path is not inside the configured `outDir` or
 * does not carry a compiled output extension.
 */
export function toSourceMappedSpecifiers(outputPath: string, mapping: SourceMapping): string[] {
  const absoluteOutput = isAbsolute(outputPath)
    ? normalizeCanonicalPath(outputPath)
    : normalizeAbsolute(resolve(mapping.outDir, outputPath));
  if (!pathInside(mapping.outDir, absoluteOutput)) return [];

  const relativeOutput = patheRelative(mapping.outDir, absoluteOutput);
  if (!relativeOutput || relativeOutput.startsWith("..")) return [];

  const stem = stripOutputExtension(relativeOutput);
  if (stem === undefined) return [];

  const candidates: string[] = [];
  for (const extension of orderedSourceExtensions(relativeOutput, mapping)) {
    candidates.push(toPosix(join(mapping.srcDir, `${stem}${extension}`)));
  }
  // `dist/feature.js` may also be generated from `src/feature/index.ts`.
  for (const extension of orderedSourceExtensions(relativeOutput, mapping)) {
    candidates.push(toPosix(join(mapping.srcDir, stem, `index${extension}`)));
  }
  return [...new Set(candidates)];
}

/** Alias for {@link toSourceMappedSpecifiers} with candidate semantics. */
export function sourceCandidatesForOutput(outputPath: string, mapping: SourceMapping): string[] {
  return toSourceMappedSpecifiers(outputPath, mapping);
}

type TsConfigShape = {
  extends?: string | string[];
  compilerOptions?: {
    outDir?: string;
    rootDir?: string;
    /**
     * Non-standard, but used by custom compiler integrations to declare the
     * source extensions they own.
     */
    sourceExtensions?: string[];
    /** Compiler plugins may declare the extension they handle. */
    plugins?: Array<{ extensions?: string[]; extension?: string }>;
  };
};

/** `tsconfig.json` plus every split project config in the same directory. */
async function discoverTsConfigFiles(rootDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name === "tsconfig.json" || /^tsconfig\.[^/]+\.json$/i.test(name)) {
      files.push(join(rootDir, name));
    }
  }
  return files.sort((left, right) => {
    // The root config wins over split configs when both define an outDir.
    const leftRoot = left.endsWith("tsconfig.json") ? 0 : 1;
    const rightRoot = right.endsWith("tsconfig.json") ? 0 : 1;
    return leftRoot - rightRoot || left.localeCompare(right);
  });
}

/** Resolve one tsconfig and its full `extends` chain into effective options. */
async function loadEffectiveCompilerOptions(
  configFile: string,
  rootDir: string,
  visited: Set<string>,
): Promise<TsConfigShape["compilerOptions"] | undefined> {
  const normalized = normalizeAbsolute(configFile);
  if (visited.has(normalized)) return undefined;
  visited.add(normalized);

  const config = await readJsonFile<TsConfigShape>(normalized);
  if (!config) return undefined;

  const configDirectory = dirname(normalized);
  let inherited: TsConfigShape["compilerOptions"] | undefined;
  const extensions = config.extends
    ? Array.isArray(config.extends)
      ? config.extends
      : [config.extends]
    : [];
  for (const extension of extensions) {
    const extensionPath =
      extension.startsWith(".") || isAbsolute(extension)
        ? resolve(configDirectory, extension)
        : join(rootDir, "node_modules", extension);
    const parent = await loadEffectiveCompilerOptions(extensionPath, rootDir, visited);
    if (parent) inherited = { ...inherited, ...parent };
  }

  return { ...inherited, ...(config.compilerOptions ?? {}) };
}

function collectDeclaredCompilerExtensions(
  compilerOptions: TsConfigShape["compilerOptions"],
): string[] {
  const collected: string[] = [];
  for (const extension of compilerOptions?.sourceExtensions ?? []) {
    const normalized = normalizeSourceExtension(extension);
    if (normalized) collected.push(normalized);
  }
  for (const plugin of compilerOptions?.plugins ?? []) {
    const declared = plugin?.extensions ?? (plugin?.extension ? [plugin.extension] : []);
    for (const extension of declared) {
      const normalized = normalizeSourceExtension(extension);
      if (normalized) collected.push(normalized);
    }
  }
  return collected;
}

/**
 * Builds every source mapping that applies to a project.
 *
 * Mappings are derived from `tsconfig` `outDir`/`rootDir` pairs, plus an
 * optional explicit `sourceMapping` configuration. Compiler extensions come
 * from three places, in increasing precedence:
 *
 *   1. The analyzer's own `extensions` option (registered compilers).
 *   2. Extensions declared inside `tsconfig` by a custom compiler integration.
 *   3. `sourceMapping.compilerExtensions` in the project configuration.
 */
export async function loadSourceMappings(
  rootDir: string,
  options: SourceMappingLoadOptions = {},
): Promise<SourceMapping[]> {
  const normalizedRoot = normalizeAbsolute(rootDir);
  const explicit = options.sourceMapping;

  const compilerExtensions = new Set<string>();
  for (const extension of options.extensions ?? []) {
    const normalized = normalizeSourceExtension(extension);
    if (normalized && !STANDARD_SOURCE_EXTENSIONS.includes(normalized)) {
      compilerExtensions.add(normalized);
    }
  }

  const sourceExtensions = explicit?.sourceExtensions?.length
    ? (explicit.sourceExtensions
        .map((extension) => normalizeSourceExtension(extension))
        .filter((extension): extension is string => Boolean(extension)) as string[])
    : STANDARD_SOURCE_EXTENSIONS;

  const mappings: SourceMapping[] = [];
  const seenOutDirs = new Set<string>();
  const pushMapping = (srcDir: string, outDir: string, extra: string[] = []): void => {
    const absoluteOut = normalizeAbsolute(outDir);
    if (seenOutDirs.has(absoluteOut)) return;
    seenOutDirs.add(absoluteOut);
    mappings.push({
      srcDir: normalizeAbsolute(srcDir),
      outDir: absoluteOut,
      sourceExtensions,
      compilerExtensions: [...new Set([...compilerExtensions, ...extra])],
    });
  };

  for (const configFile of await discoverTsConfigFiles(normalizedRoot)) {
    const compilerOptions = await loadEffectiveCompilerOptions(
      configFile,
      normalizedRoot,
      new Set(),
    );
    if (!compilerOptions?.outDir) continue;
    const configDirectory = dirname(configFile);
    pushMapping(
      resolve(configDirectory, compilerOptions.rootDir ?? "src"),
      resolve(configDirectory, compilerOptions.outDir),
      collectDeclaredCompilerExtensions(compilerOptions),
    );
  }

  if (explicit?.outDir) {
    pushMapping(
      explicit.srcDir ? resolve(normalizedRoot, explicit.srcDir) : resolve(normalizedRoot, "src"),
      resolve(normalizedRoot, explicit.outDir),
      (explicit.compilerExtensions ?? [])
        .map((extension) => normalizeSourceExtension(extension))
        .filter((extension): extension is string => Boolean(extension)),
    );
  }

  return mappings;
}
