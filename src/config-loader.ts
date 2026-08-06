import path from "pathe";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { Config, ResolvedOptions, AnalyzerOptions } from "./types.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORE, normalizeAbsolute } from "./fs-utils.js";

export const DEFAULT_CONFIG: ResolvedOptions = {
  rootDir: normalizeAbsolute(process.cwd()),
  entry: [],
  extensions: DEFAULT_EXTENSIONS,
  ignore: DEFAULT_IGNORE,
  reportUnusedExports: true,
  schemaEnums: {},
  failOn: "high",
  json: false,
  includeConventionalEntries: true,
  externalContracts: [],
  verbose: false,
  fix: false,
  pathAliases: new Map<string, string[]>(),
  layers: {
    smtTimeoutMs: 100,
    isolateMemoryLimitMb: 16,
    enableConcolicProof: true,
    skip3: false,
    skip4: false,
  },
  rules: {
    'unused-export': 'warning',
    'unreachable-file': 'warning',
    'constant-condition': 'warning',
    'unreachable-dynamic-path': 'warning',
  }
};

export async function loadConfig(rootDir: string): Promise<Config> {
  const configPaths = [
    path.join(rootDir, "optiprune.config.ts"),
    path.join(rootDir, "optiprune.config.js"),
    path.join(rootDir, "optiprune.config.mjs"),
  ];

  for (const configPath of configPaths) {
    if (fs.existsSync(configPath)) {
      try {
        const configUrl = pathToFileURL(configPath).href;
        const module = await import(configUrl);
        return module.default || module;
      } catch (e) {
        console.warn(`[Config] Failed to load config from ${configPath}:`, e);
      }
    }
  }

  return {};
}

export function mergeConfig(base: ResolvedOptions, userConfig: Config): ResolvedOptions {
  // 1. Check if user explicitly passed non-empty entry array
  const hasUserEntries = Array.isArray(userConfig.entry) && userConfig.entry.length > 0;

  // 2. Normalize rootDir to POSIX
  const rootDir = userConfig.rootDir ? normalizeAbsolute(userConfig.rootDir) : base.rootDir;

  // 3. Normalize entries to POSIX absolute paths
  const rawEntries = hasUserEntries ? userConfig.entry! : (userConfig.entry || base.entry);
  const entry = rawEntries.map(e => normalizeAbsolute(path.resolve(rootDir, e)));

  // 4. If explicit entries are supplied, force includeConventionalEntries to false unless user explicitly said otherwise
  const includeConventionalEntries = hasUserEntries
    ? (userConfig.includeConventionalEntries ?? false)
    : (userConfig.includeConventionalEntries ?? base.includeConventionalEntries);

  return {
    ...base,
    ...userConfig,
    rootDir,
    entry,
    includeConventionalEntries,
    layers: {
      ...base.layers,
      ...userConfig.layers,
    },
    rules: {
      ...base.rules,
      ...userConfig.rules,
    },
    externalContracts: [
      ...base.externalContracts,
      ...(userConfig.externalContracts || []),
    ],
  } as ResolvedOptions;
}