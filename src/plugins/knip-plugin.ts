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
  "entry",
  "project",
  "workspaces",
  "ignore",
  "ignoreFiles",
  "ignoreDependencies",
  "ignoreIssues",
  "includeEntryExports",
  "paths",
]);

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

function applyIgnoreIssues(config: Record<string, StaticConfigValue>, workspace: string, adapter: PluginAdapter): void {
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
  workspace = ".",
): void {
  const entries = prefixedPatterns(workspace, stringArray(config.entry));
  const projects = prefixedPatterns(workspace, stringArray(config.project));
  const ignored = prefixedPatterns(workspace, stringArray(config.ignore));
  const ignoredFiles = prefixedPatterns(workspace, stringArray(config.ignoreFiles));

  if (entries.length > 0) {
    adapter.addEntryPatterns(entries);
    // Knip deliberately excludes entry-file exports unless this opt-in is set.
    if (config.includeEntryExports !== true) {
      adapter.addProtectedExportPatterns(entries);
    }
  }
  if (projects.length > 0) adapter.addProjectPatterns(projects);
  if (ignored.length > 0) {
    // Knip ignores suppress reports rather than excluding parsing. Preserve analysis,
    // while preventing file/export removal in the matching paths.
    adapter.addUnreachableFileIgnorePatterns(ignored);
    adapter.addProtectedExportPatterns(ignored);
  }
  if (ignoredFiles.length > 0) adapter.addUnreachableFileIgnorePatterns(ignoredFiles);
  adapter.addIgnoredDependencies(dependencyNames(config.ignoreDependencies));
  applyIgnoreIssues(config, workspace, adapter);

  const workspaces = stringRecord(config.workspaces);
  for (const [workspacePattern, workspaceConfig] of Object.entries(workspaces)) {
    if (workspacePattern !== ".") adapter.setWorkspaceGlobs([workspacePattern]);
    const nestedConfig = stringRecord(workspaceConfig);
    applyKnipConfig(nestedConfig, adapter, workspacePattern);
  }

  // Knip plugins may declare their own entry file patterns at root or workspace level.
  for (const [key, value] of Object.entries(config)) {
    if (KNIP_CONFIG_KEYS.has(key)) continue;
    const pluginConfig = stringRecord(value);
    const pluginEntries = prefixedPatterns(workspace, stringArray(pluginConfig.entry));
    if (pluginEntries.length > 0) {
      adapter.addEntryPatterns(pluginEntries);
      if (pluginConfig.includeEntryExports !== true) adapter.addProtectedExportPatterns(pluginEntries);
    }
  }
}

async function loadKnipConfig(adapter: PluginAdapter) {
  const loaded = await loadStaticPluginConfig(adapter, KNIP_CONFIG_FILES, "knip");
  if (!loaded) return undefined;

  // Dedicated Knip config filenames are already collision-resistant. For an
  // inline package.json configuration, the `knip` key is definitive. For a
  // dynamic config that cannot be statically read, no settings are applied.
  return hasKnipShape(loaded.config) || loaded.source.startsWith("package.json#")
    ? loaded
    : undefined;
}

export const KnipPlugin: AnalyzerPlugin = {
  name: "knip-plugin",
  version: "1.0.0",

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
      (script) => typeof script === "string" && /(?:^|\s)(?:pnpm\s+exec\s+|yarn\s+|bunx\s+|npx\s+)?knip(?:\s|$)/.test(script),
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
      if (typeof allDependencies.knip === "string") adapter.markPackageAsUsed("knip");

      for (const [name, script] of Object.entries(pkg?.scripts ?? {})) {
        if (typeof script === "string" && /(?:^|\s)(?:pnpm\s+exec\s+|yarn\s+|bunx\s+|npx\s+)?knip(?:\s|$)/.test(script)) {
          adapter.markAsUsed("package.json", `scripts:${name}`);
        }
      }
    },
  },
};

export default KnipPlugin;
