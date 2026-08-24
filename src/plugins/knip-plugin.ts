import type { AnalyzerPlugin, PluginAdapter } from "../types.js";
import {
  loadStaticPluginConfig,
  stringArray,
  stringRecord,
  type StaticConfigValue,
} from "../plugin-config.js";

const KNIP_CONFIG_FILES = [
  "knip.json",
  "knip.jsonc",
  ".knip.json",
  ".knip.jsonc",
  "knip.ts",
  "knip.js",
  "knip.mjs",
  "knip.cjs",
  "knip.config.ts",
  "knip.config.js",
  "knip.config.mjs",
  "knip.config.cjs",
];

const KNIP_CONFIG_KEYS = new Set([
  "$schema",
  "entry",
  "project",
  "workspaces",
  "ignore",
  "ignoreFiles",
  "ignoreDependencies",
  "ignoreBinaries",
  "ignoreMembers",
  "ignoreUnresolved",
  "ignoreWorkspaces",
  "ignoreIssues",
  "ignoreExportsUsedInFile",
  "includeEntryExports",
  "paths",
  "rules",
  "compilers",
  "tags",
  "classMembers",
]);

/**
 * Strips comments safely without breaking strings/URLs (e.g. `$schema: "https://..."`),
 * then cleans trailing commas.
 */
function parseJsonc(content: string): Record<string, StaticConfigValue> | undefined {
  try {
    // Matches string literals OR comments; preserves the string contents untouched
    const stripped = content
      .replace(/("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (match, str) => (str ? str : ""))
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

/**
 * Statically extracts object literals from JS/TS configs.
 * Handles:
 * - `export default { ... }`
 * - `export default () => ({ ... })` / `export default async () => ({ ... })`
 * - `defineConfig({ ... })` / `defineConfig(() => ({ ... }))`
 * - `module.exports = { ... }`
 * - `const config = { ... }; export default config;`
 */
function extractStaticJsTsObject(code: string): Record<string, StaticConfigValue> | undefined {
  const cleanCode = code
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (match, str) => (str ? str : ""));

  // Match default exports (including arrow/function wraps) or variable declarations
  const match =
    cleanCode.match(
      /(?:export\s+default\s+(?:defineConfig\s*\(\s*)?(?:(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>\s*\(?)?|module\.exports\s*=\s*)([\s\S]+?)(?:\s*\)\s*)?(?:;|\n|$)/
    ) ||
    cleanCode.match(/(?:const|let|var)\s+config(?:\s*:\s*[A-Za-z0-9_<>]+)?\s*=\s*([\s\S]+?);/);

  if (!match) return undefined;

  let rawObjectStr = match[1]?.trim();
  if (!rawObjectStr) return undefined;

  // Unwrap parentheses if wrapped like `({ ... })`
  if (rawObjectStr.startsWith("(") && rawObjectStr.endsWith(")")) {
    rawObjectStr = rawObjectStr.slice(1, -1).trim();
  }

  // Extract from the first '{' to the last '}'
  const firstBrace = rawObjectStr.indexOf("{");
  const lastBrace = rawObjectStr.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) return undefined;

  rawObjectStr = rawObjectStr.slice(firstBrace, lastBrace + 1);

  try {
    const jsonish = rawObjectStr
      // Strip type assertions (`satisfies KnipConfig`, `as KnipConfig`)
      .replace(/\s+(?:satisfies|as)\s+[A-Za-z0-9_<>]+/g, "")
      // Quote unquoted object keys
      .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
      // Replace single-quoted string literals with double quotes
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      // Remove trailing commas
      .replace(/,\s*([}\]])/g, "$1");

    return JSON.parse(jsonish);
  } catch {
    return undefined;
  }
}

function hasKnipShape(config: Record<string, StaticConfigValue>): boolean {
  return Object.keys(config).some((key) => KNIP_CONFIG_KEYS.has(key));
}

function prefixedPatterns(workspace: string, patterns: string[]): string[] {
  if (workspace === "." || workspace === "") return patterns;
  const prefix = workspace.replace(/\/$/, "");
  return patterns.map((pattern) => {
    const negated = pattern.startsWith("!");
    const rawPattern = negated ? pattern.slice(1) : pattern;
    const joined = `${prefix}/${rawPattern.replace(/^\.\//, "")}`;
    return negated ? `!${joined}` : joined;
  });
}

function dependencyNames(value: StaticConfigValue | undefined): string[] {
  return stringArray(value)
    .map((name) => name.replace(/!$/, ""))
    .filter((name) => /^[A-Za-z@][A-Za-z0-9@/_.-]*$/.test(name));
}

function applyIgnoreIssues(
  config: Record<string, StaticConfigValue>,
  workspace: string,
  adapter: PluginAdapter
): void {
  for (const [pattern, issueTypes] of Object.entries(stringRecord(config.ignoreIssues))) {
    const types = stringArray(issueTypes);
    const scopedPattern = prefixedPatterns(workspace, [pattern]);
    if (types.some((type) => ["exports", "types", "enumMembers", "namespaceMembers"].includes(type))) {
      adapter.addProtectedExportPatterns(scopedPattern);
    }
    if (types.includes("files")) {
      adapter.addUnreachableFileIgnorePatterns(scopedPattern);
    }
  }
}

function applyKnipConfig(
  config: Record<string, StaticConfigValue>,
  adapter: PluginAdapter,
  workspace = "."
): void {
  const entries = prefixedPatterns(workspace, stringArray(config.entry));
  const ignored = prefixedPatterns(workspace, stringArray(config.ignore));
  const ignoredFiles = prefixedPatterns(workspace, stringArray(config.ignoreFiles));

  // 1. Entry patterns & exported roots
  if (entries.length > 0) {
    adapter.addEntryPatterns(entries);
    if (config.includeEntryExports !== true) {
      adapter.addProtectedExportPatterns(entries);
    }
  }

  // 2. Ignore patterns (files & exports)
  if (ignored.length > 0) {
    adapter.addUnreachableFileIgnorePatterns(ignored);
    adapter.addProtectedExportPatterns(ignored);
  }
  if (ignoredFiles.length > 0) {
    adapter.addUnreachableFileIgnorePatterns(ignoredFiles);
  }

  // 3. Dependency, Binary, and Unresolved ignore lists
  const allIgnoredDeps = [
    ...dependencyNames(config.ignoreDependencies),
    ...dependencyNames(config.ignoreBinaries),
    ...dependencyNames(config.ignoreUnresolved),
  ];
  if (allIgnoredDeps.length > 0) {
    adapter.addIgnoredDependencies(allIgnoredDeps);
  }

  // 4. Detailed issue suppressions
  applyIgnoreIssues(config, workspace, adapter);

  // 5. Workspaces configuration
  const ignoredWorkspaces = new Set(stringArray(config.ignoreWorkspaces));
  const workspaces = stringRecord(config.workspaces);

  for (const [workspacePattern, workspaceConfig] of Object.entries(workspaces)) {
    if (ignoredWorkspaces.has(workspacePattern)) continue;

    if (workspacePattern !== ".") {
      adapter.setWorkspaceGlobs([workspacePattern]);
    }
    if (workspaceConfig && typeof workspaceConfig === "object" && !Array.isArray(workspaceConfig)) {
      const nestedConfig = stringRecord(workspaceConfig);
      applyKnipConfig(nestedConfig, adapter, workspacePattern);
    }
  }
}

async function loadKnipConfig(
  adapter: PluginAdapter
): Promise<{ config: Record<string, StaticConfigValue>; source: string } | undefined> {
  const loaded = await loadStaticPluginConfig(adapter, KNIP_CONFIG_FILES, "knip");
  if (loaded && (hasKnipShape(loaded.config) || loaded.source.startsWith("package.json#"))) {
    return loaded;
  }

  for (const file of KNIP_CONFIG_FILES) {
    const content = await adapter.readFile(file);
    if (!content) continue;

    let config: Record<string, StaticConfigValue> | undefined;

    if (file.endsWith(".json") || file.endsWith(".jsonc")) {
      config = parseJsonc(content);
    } else {
      config = extractStaticJsTsObject(content);
    }

    if (config && typeof config === "object" && hasKnipShape(config)) {
      return { config, source: file };
    }
  }

  return undefined;
}

export const KnipPlugin: AnalyzerPlugin = {
  name: "knip-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    if (await loadKnipConfig(adapter)) return true;

    const pkg = await adapter.readJson("package.json");
    const allDependencies = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    const hasDependency = typeof allDependencies.knip === "string";
    const hasKnipScript = Object.values(pkg?.scripts ?? {}).some(
      (script) =>
        typeof script === "string" &&
        /(?:^|\s)(?:pnpm\s+exec\s+|yarn\s+|bunx\s+|npx\s+)?knip(?:\s|$)/.test(script)
    );
    return hasDependency || hasKnipScript;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const loaded = await loadKnipConfig(adapter);
      if (loaded) applyKnipConfig(loaded.config, adapter);

      const pkg = await adapter.readJson("package.json");
      const allDependencies = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };
      if (typeof allDependencies.knip === "string") {
        adapter.markPackageAsUsed("knip");
      }

      for (const [name, script] of Object.entries(pkg?.scripts ?? {})) {
        if (
          typeof script === "string" &&
          /(?:^|\s)(?:pnpm\s+exec\s+|yarn\s+|bunx\s+|npx\s+)?knip(?:\s|$)/.test(script)
        ) {
          adapter.markAsUsed("package.json", `scripts:${name}`);
        }
      }
    },
  },
};

export default KnipPlugin;