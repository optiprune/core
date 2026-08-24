/**
 * config-loader.ts
 *
 * Hardcoded configuration loader for OptiPrune.
 *
 * Resolution order (first match wins):
 *   1. optiprune.json   – plain JSON
 *   2. optiprune.jsonc  – JSON with // and /* … *\/ comments + trailing commas
 *   3. optiprune.config.ts  – TypeScript ESM default export
 *   4. optiprune.config.js  – JavaScript ESM default export
 *   5. optiprune.config.mjs – JavaScript ESM default export
 *   6. package.json "optiprune" field
 *
 * All sources are normalised through `mergeConfig` so the rest of the
 * codebase only ever sees a fully-resolved `ResolvedOptions` object.
 */

import path from "pathe";
import fs from "node:fs";
import { createJiti } from "jiti";
import type { Config, ResolvedOptions, OutputFormat } from "./types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE, normalizeAbsolute } from "./fs-utils.js";
import { formatJsonDiagnostic, parseJsonDocument } from "./json-utils.js";

// ---------------------------------------------------------------------------
// Default resolved configuration
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: ResolvedOptions = {
  rootDir: normalizeAbsolute(process.cwd()),
  entry: [],
  extensions: DEFAULT_EXTENSIONS,
  ignore: DEFAULT_IGNORE,
  ignoreDependencies: [],
  reportUnusedExports: true,
  reportUnusedExportsInUnreachableFiles: false,
  schemaEnums: {},
  failOn: "high",
  json: false,
  output: "terminal",
  includeConventionalEntries: true,
  includeEntryExports: false,
  cycles: false,
  ignoreTests: false,
  ignoreUnknownImport: false,
  externalContracts: [],
  verbose: false,
  fix: false,
  workspaceGlobs: [],
  projectPatterns: [],
  unreachableFileIgnorePatterns: [],
  protectedExportPatterns: [],
  frameworks: [],
  pathAliases: new Map<string, string[]>(),
  packageImports: new Map<string, string[]>(),
  layers: {
    smtTimeoutMs: 100,
    isolateMemoryLimitMb: 16,
    enableConcolicProof: true,
    skip3: false,
    skip4: false,
  },
  rules: {
    "unused-export": "warning",
    "unreachable-file": "warning",
    "constant-condition": "warning",
    "unreachable-dynamic-path": "warning",
  },
  plugins: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely read a file; returns null on any error. */
function tryReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function parseConfigJson<T = unknown>(label: string, raw: string): T | null {
  const parsed = parseJsonDocument<T>(raw);
  if (parsed.value === undefined) {
    const primary = parsed.diagnostics[0];
    console.warn(`[Config] ${label} could not be parsed: ${primary ? formatJsonDiagnostic(primary) : "unknown JSON error"} – skipping.`);
    return null;
  }
  if (!parsed.valid) {
    const primary = parsed.diagnostics[0];
    console.warn(`[Config] ${label} is not strict JSON: ${primary ? formatJsonDiagnostic(primary) : "recoverable JSON syntax"} – using a safe recovered value.`);
  }
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load user configuration from the project root.
 *
 * The function is intentionally synchronous-first for JSON/JSONC sources so
 * that the config is available as early as possible in the analysis pipeline.
 * TypeScript/JS config files are loaded via jiti.
 */
export async function loadConfig(rootDir: string): Promise<Config> {
  // ── 1. optiprune.json ────────────────────────────────────────────────────
  const jsonPath = path.join(rootDir, "optiprune.json");
  if (fs.existsSync(jsonPath)) {
    const raw = tryReadFile(jsonPath);
    if (raw !== null) {
      const parsed = parseConfigJson<Config>("optiprune.json", raw);
      if (parsed !== null) {
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug("[Config] Loaded from optiprune.json");
        }
        return parsed;
      }
    }
  }

  // ── 2. optiprune.jsonc ───────────────────────────────────────────────────
  const jsoncPath = path.join(rootDir, "optiprune.jsonc");
  if (fs.existsSync(jsoncPath)) {
    const raw = tryReadFile(jsoncPath);
    if (raw !== null) {
      const parsed = parseConfigJson<Config>("optiprune.jsonc", raw);
      if (parsed !== null) {
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug("[Config] Loaded from optiprune.jsonc");
        }
        return parsed;
      }
    }
  }

  // ── 3-5. optiprune.config.{ts,js,mjs} ───────────────────────────────────
  const scriptPaths = [
    path.join(rootDir, "optiprune.config.ts"),
    path.join(rootDir, "optiprune.config.js"),
    path.join(rootDir, "optiprune.config.mjs"),
  ];

  for (const configPath of scriptPaths) {
    if (!fs.existsSync(configPath)) continue;

    try {
      const jiti = createJiti(import.meta.url, {
        interopDefault: true,
      });

      const mod = await jiti.import<{ default?: Config } & Config>(configPath);
      const exported = mod.default ?? mod;

      if (exported && typeof exported === "object") {
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug(`[Config] Loaded from ${path.basename(configPath)}`);
        }
        return exported as Config;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Config] Failed to load ${path.basename(configPath)}: ${message}`);
    }
  }

  // ── 6. package.json "optiprune" field ────────────────────────────────────
  const pkgPath = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const raw = tryReadFile(pkgPath);
    if (raw !== null) {
      const pkg = parseConfigJson<Record<string, unknown>>("package.json", raw);
      if (pkg?.optiprune && typeof pkg.optiprune === "object") {
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug("[Config] Loaded from package.json#optiprune");
        }
        return pkg.optiprune as Config;
      }
    }
  }

  // No config found – return empty object; defaults will be applied by mergeConfig.
  return {};
}

// ---------------------------------------------------------------------------
// mergeConfig
// ---------------------------------------------------------------------------

/**
 * Merge a base `ResolvedOptions` with a user-supplied `Config`.
 */
export function mergeConfig(base: ResolvedOptions, userConfig: Config): ResolvedOptions {
  // ── rootDir ──────────────────────────────────────────────────────────────
  const rootDir = userConfig.rootDir
    ? normalizeAbsolute(userConfig.rootDir)
    : base.rootDir;

  // ── entry ────────────────────────────────────────────────────────────────
  const hasUserEntries = Array.isArray(userConfig.entry) && userConfig.entry.length > 0;
  const rawEntries = hasUserEntries
    ? userConfig.entry!
    : (userConfig.entry ?? base.entry);
  const entry = rawEntries.map((e) => normalizeAbsolute(path.resolve(rootDir, e)));

  // ── includeConventionalEntries ───────────────────────────────────────────
  const includeConventionalEntries = hasUserEntries
    ? (userConfig.includeConventionalEntries ?? false)
    : (userConfig.includeConventionalEntries ?? base.includeConventionalEntries);

  // ── extensions ───────────────────────────────────────────────────────────
  const extensions = Array.isArray(userConfig.extensions) && userConfig.extensions.length > 0
    ? userConfig.extensions
    : base.extensions;

  // ── ignore ───────────────────────────────────────────────────────────────
  const userIgnore = Array.isArray(userConfig.ignore) ? userConfig.ignore : [];
  const ignore = Array.from(new Set([...DEFAULT_IGNORE, ...userIgnore]));

  // ── ignoreDependencies ───────────────────────────────────────────────────
  const ignoreDependencies = Array.isArray(userConfig.ignoreDependencies)
    ? userConfig.ignoreDependencies
    : base.ignoreDependencies;

  // ── externalContracts ────────────────────────────────────────────────────
  const externalContracts = Array.isArray(userConfig.externalContracts)
    ? Array.from(new Set([...base.externalContracts, ...userConfig.externalContracts]))
    : base.externalContracts;

  // ── output / json ────────────────────────────────────────────────────────
  let output: OutputFormat = base.output;
  let json: boolean = base.json;

  if (userConfig.output) {
    output = userConfig.output;
    json = output === "json";
  } else if (typeof userConfig.json === "boolean") {
    json = userConfig.json;
    output = json ? "json" : "terminal";
  }

  // ── layers ───────────────────────────────────────────────────────────────
  const layers = {
    ...base.layers,
    ...(userConfig.layers ?? {}),
  };

  // ── rules ────────────────────────────────────────────────────────────────
  const rules = {
    ...base.rules,
    ...(userConfig.rules ?? {}),
  };

  // ── plugins ──────────────────────────────────────────────────────────────
  let plugins = { ...base.plugins };
  if (userConfig.plugins) {
    if (Array.isArray(userConfig.plugins)) {
      for (const pluginName of userConfig.plugins) {
        if (typeof pluginName === "string") {
          plugins[pluginName] = true;
        }
      }
    } else if (typeof userConfig.plugins === "object") {
      plugins = { ...plugins, ...userConfig.plugins };
    }
  }

  return {
    ...base,
    rootDir,
    entry,
    includeConventionalEntries,
    includeEntryExports: userConfig.includeEntryExports ?? base.includeEntryExports,
    cycles: userConfig.cycles ?? base.cycles,
    ignoreTests: userConfig.ignoreTests ?? base.ignoreTests,
    ignoreUnknownImport: userConfig.ignoreUnknownImport ?? base.ignoreUnknownImport,
    extensions,
    ignore,
    ignoreDependencies,
    externalContracts,
    output,
    json,
    layers,
    rules,
    plugins,
    ...(userConfig.failOn !== undefined && { failOn: userConfig.failOn }),
    ...(userConfig.reportUnusedExports !== undefined && {
      reportUnusedExports: userConfig.reportUnusedExports,
    }),
    ...(userConfig.reportUnusedExportsInUnreachableFiles !== undefined && {
      reportUnusedExportsInUnreachableFiles: userConfig.reportUnusedExportsInUnreachableFiles,
    }),
    ...(userConfig.verbose !== undefined && { verbose: userConfig.verbose }),
    fix: userConfig.fix !== undefined ? userConfig.fix : base.fix,
  } as ResolvedOptions;
}