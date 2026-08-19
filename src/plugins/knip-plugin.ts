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
  "ignoreIssues",
  "includeEntryExports",
  "paths",
  "rules",
  "compilers",
  "tags",
  "classMembers",
]);

/**
 * Strips single-line and multi-line comments + trailing commas from JSON/JSONC strings.
 */
function parseJsonc(content: string): Record<string, StaticConfigValue> | undefined {
  try {
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1")
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(stripped);
  } catch {
    return undefined;
  }
}

/**
 * Statically extracts object properties from JS/TS config AST files.
 * Handles `export default { ... }`, `module.exports = { ... }`, and `defineConfig({ ... })`.
 */
function extractStaticJsTsObject(code: string): Record<string, StaticConfigValue> | undefined {
  // Strip comments
  const cleanCode = code.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");

  // Match: export default { ... }, module.exports = { ... }, or defineConfig({ ... })
  const match =
    cleanCode.match(/(?:export\s+default\s+(?:defineConfig\s*\(\s*)?|module\.exports\s*=\s*)([\s\S]+?)(?:\s*\)\s*)?(?:;|\n|$)/) ||
    cleanCode.match(/const\s+config(?:\s*:\s*KnipConfig)?\s*=\s*([\s\S]+?);/);

  if (!match) return undefined;

  const rawObjectStr = match[1]?.trim();
  if (!rawObjectStr || !rawObjectStr.startsWith("{")) return undefined;

  // Convert relaxed JS/TS object literal to JSON-parseable string
  try {
    const jsonish = rawObjectStr
      // Remove trailing type assertions like `satisfies KnipConfig` or `as KnipConfig`
      .replace(/\s+(?:satisfies|as)\s+[A-Za-z0-9_<>]+/g, "")
      // Quote unquoted object keys (e.g. entry: -> "entry":)
      .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
      // Replace single quotes with double quotes for string values
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
      // Remove trailing commas in objects and arrays
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
  const projects = prefixedPatterns(workspace, stringArray(config.project));
  const ignored = prefixedPatterns(workspace, stringArray(config.ignore));
  const ignoredFiles = prefixedPatterns(workspace, stringArray(config.ignoreFiles));

  if (entries.length > 0) {
    adapter.addEntryPatterns(entries);
    if (config.includeEntryExports !== true) {
      adapter.addProtectedExportPatterns(entries);
    }
  }
  if (projects.length > 0) adapter.addProjectPatterns(projects);
  if (ignored.length > 0) {
    adapter.addUnreachableFileIgnorePatterns(ignored);
    adapter.addProtectedExportPatterns(ignored);
  }
  if (ignoredFiles.length > 0) adapter.addUnreachableFileIgnorePatterns(ignoredFiles);
  adapter.addIgnoredDependencies(dependencyNames(config.ignoreDependencies));
  applyIgnoreIssues(config, workspace, adapter);

  const workspaces = stringRecord(config.workspaces);
  for (const [workspacePattern, workspaceConfig] of Object.entries(workspaces)) {
    if (workspacePattern !== ".") adapter.setWorkspaceGlobs([workspacePattern]);
    if (workspaceConfig && typeof workspaceConfig === "object" && !Array.isArray(workspaceConfig)) {
      const nestedConfig = stringRecord(workspaceConfig);
      applyKnipConfig(nestedConfig, adapter, workspacePattern);
    }
  }

  // Knip plugins (e.g., eslint, vite, next) may declare entry patterns
  for (const [key, value] of Object.entries(config)) {
    if (KNIP_CONFIG_KEYS.has(key)) continue;
    // Guard against boolean flags ("eslint": false) or non-object primitives
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;

    const pluginConfig = stringRecord(value);
    const pluginEntries = prefixedPatterns(workspace, stringArray(pluginConfig.entry));
    if (pluginEntries.length > 0) {
      adapter.addEntryPatterns(pluginEntries);
      if (pluginConfig.includeEntryExports !== true) {
        adapter.addProtectedExportPatterns(pluginEntries);
      }
    }
  }
}

async function loadKnipConfig(
  adapter: PluginAdapter
): Promise<{ config: Record<string, StaticConfigValue>; source: string } | undefined> {
  // 1. Try generic static helper first
  const loaded = await loadStaticPluginConfig(adapter, KNIP_CONFIG_FILES, "knip");
  if (loaded && (hasKnipShape(loaded.config) || loaded.source.startsWith("package.json#"))) {
    return loaded;
  }

  // 2. Direct fallback reading for .jsonc, .json, .ts, .js, .mjs, .cjs files
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
  version: "1.1.0",

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