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
import { pathToFileURL } from "node:url";
import type { Config, ResolvedOptions, OutputFormat } from "./types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE, normalizeAbsolute } from "./fs-utils.js";

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
  schemaEnums: {},
  failOn: "high",
  json: false,
  output: "terminal",
  includeConventionalEntries: true,
  includeEntryExports: false,
  cycles: false,
  ignoreTests: false,
  externalContracts: [],
  verbose: false,
  fix: false,
  workspaceGlobs: [],
  projectPatterns: [],
  unreachableFileIgnorePatterns: [],
  protectedExportPatterns: [],
  frameworks: [],
  pathAliases: new Map<string, string[]>(),
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
// JSONC parser (strips // line comments, /* block comments */, trailing commas)
// ---------------------------------------------------------------------------

function parseJsonc<T = unknown>(raw: string): T {
  const stripped = raw
    // Remove single-line comments (// …) – but not inside strings
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, str) => (str ? m : ""))
    // Remove block comments (/* … */)
    .replace(/("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\//g, (m, str) => (str ? m : ""))
    // Remove trailing commas before ] or }
    .replace(/,(\s*[}\]])/g, "$1");

  return JSON.parse(stripped) as T;
}

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

/** Safely parse JSON; returns null on any error. */
function tryParseJson<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load user configuration from the project root.
 *
 * The function is intentionally synchronous-first for JSON/JSONC sources so
 * that the config is available as early as possible in the analysis pipeline.
 * TypeScript/JS config files are still loaded asynchronously via dynamic
 * `import()`.
 */
export async function loadConfig(rootDir: string): Promise<Config> {
  // ── 1. optiprune.json ────────────────────────────────────────────────────
  const jsonPath = path.join(rootDir, "optiprune.json");
  if (fs.existsSync(jsonPath)) {
    const raw = tryReadFile(jsonPath);
    if (raw !== null) {
      const parsed = tryParseJson<Config>(raw);
      if (parsed !== null) {
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug("[Config] Loaded from optiprune.json");
        }
        return parsed;
      }
      console.warn("[Config] optiprune.json exists but could not be parsed as JSON – skipping.");
    }
  }

  // ── 2. optiprune.jsonc ───────────────────────────────────────────────────
  const jsoncPath = path.join(rootDir, "optiprune.jsonc");
  if (fs.existsSync(jsoncPath)) {
    const raw = tryReadFile(jsoncPath);
    if (raw !== null) {
      try {
        const parsed = parseJsonc<Config>(raw);
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug("[Config] Loaded from optiprune.jsonc");
        }
        return parsed;
      } catch (e) {
        console.warn(`[Config] optiprune.jsonc could not be parsed: ${(e as Error).message} – skipping.`);
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
      let loadPath = configPath;

      // Transpile TypeScript to a temporary ESM file so Node can import it.
      if (configPath.endsWith(".ts")) {
        try {
          const esbuild = await import("esbuild");
          const code = fs.readFileSync(configPath, "utf-8");
          const result = await esbuild.transform(code, {
            loader: "ts",
            format: "esm",
            target: "node22",
          });
          const tempJsPath = path.join(rootDir, `.optiprune.config.${Date.now()}.mjs`);
          fs.writeFileSync(tempJsPath, result.code, "utf-8");
          loadPath = tempJsPath;
        } catch (transpileError) {
          console.warn(`[Config] Failed to transpile TypeScript config ${configPath}:`, transpileError);
        }
      }

      const configUrl = pathToFileURL(loadPath).href;
      const mod = await import(configUrl);

      // Clean up temporary transpiled file if created.
      if (loadPath !== configPath && fs.existsSync(loadPath)) {
        try { fs.unlinkSync(loadPath); } catch { /* ignore */ }
      }

      const exported = mod.default ?? mod;
      if (exported && typeof exported === "object") {
        if (process.env.OPTIPRUNE_DEBUG) {
          console.debug(`[Config] Loaded from ${path.basename(configPath)}`);
        }
        return exported as Config;
      }
    } catch (e) {
      console.warn(`[Config] Failed to load config from ${configPath}:`, e);
    }
  }

  // ── 6. package.json "optiprune" field ────────────────────────────────────
  const pkgPath = path.join(rootDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const raw = tryReadFile(pkgPath);
    if (raw !== null) {
      const pkg = tryParseJson<Record<string, unknown>>(raw);
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
 *
 * Rules:
 * - Arrays (`entry`, `ignore`, `extensions`, `externalContracts`,
 *   `ignoreDependencies`) are **replaced** when the user supplies them
 *   (not merged), so the user has full control.
 * - `ignore` is the only exception: user patterns are **appended** to the
 *   built-in DEFAULT_IGNORE list so that node_modules etc. are always
 *   excluded.
 * - `layers` and `rules` are shallow-merged (user values win).
 * - `plugins` is shallow-merged (user values win).
 * - The `json` boolean and the `output` string are kept in sync:
 *     - If `output` is set, it takes precedence and `json` is derived.
 *     - If only `json: true` is set, `output` is set to `"json"`.
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
  // When the user explicitly provides entry points, default to false unless
  // they also explicitly set this flag.
  const includeConventionalEntries = hasUserEntries
    ? (userConfig.includeConventionalEntries ?? false)
    : (userConfig.includeConventionalEntries ?? base.includeConventionalEntries);

  // ── extensions ───────────────────────────────────────────────────────────
  const extensions = Array.isArray(userConfig.extensions) && userConfig.extensions.length > 0
    ? userConfig.extensions
    : base.extensions;

  // ── ignore ───────────────────────────────────────────────────────────────
  // Always keep the built-in DEFAULT_IGNORE patterns; user patterns are
  // appended so they can add more without accidentally removing the defaults.
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
      // Support array of plugin names for simple enabling
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
    extensions,
    ignore,
    ignoreDependencies,
    externalContracts,
    output,
    json,
    layers,
    rules,
    plugins,
    // Scalar overrides – only apply when explicitly provided
    ...(userConfig.failOn !== undefined && { failOn: userConfig.failOn }),
    ...(userConfig.reportUnusedExports !== undefined && {
      reportUnusedExports: userConfig.reportUnusedExports,
    }),
    ...(userConfig.verbose !== undefined && { verbose: userConfig.verbose }),
    fix: userConfig.fix !== undefined ? userConfig.fix : base.fix,
  } as ResolvedOptions;
}
