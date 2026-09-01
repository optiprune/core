import { AnalyzerPlugin } from "../types.js";
import { loadStaticPluginConfig, stringArray, stringRecord } from "../plugin-config.js";
import path from "pathe";

const BIOME_CONFIG_BASENAMES = ["biome.json", "biome.jsonc", ".biome.json", ".biome.jsonc"];
const BIOME_PACKAGE = "@biomejs/biome";

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function directoryOf(fileId: string): string {
  const normalized = normalize(fileId);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function isBiomeScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])biome(?:\s|$)/.test(script) ||
    /\bnpx\s+(?:--yes\s+)?@biomejs\/biome\b/.test(script) ||
    /\bpnpm\s+(?:exec\s+)?biome\b/.test(script) ||
    /\byarn\s+(?:dlx\s+)?biome\b/.test(script)
  );
}

function hasBiomeDependency(packageJson: any): boolean {
  return [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
  ].some((section) => !!section?.[BIOME_PACKAGE]);
}

function resolveRelativeConfigPath(configFile: string, referencedPath: string): string | undefined {
  if (!referencedPath || referencedPath.startsWith("@") || referencedPath === "//")
    return undefined;
  const directory = directoryOf(configFile);
  const candidate = path.normalize(path.join(directory || ".", referencedPath)).replace(/\\/g, "/");
  if (!candidate.startsWith("..")) return candidate;
  return undefined;
}

/**
 * Biome resolves a configuration from the current directory upward and supports
 * nested config files. Configuration is therefore legitimate evidence that the
 * locally declared Biome package is used, while a config without the package is
 * a precise missing-dependency signal rather than an unused-dependency exception.
 */
export const BiomePlugin: AnalyzerPlugin = {
  name: "biome-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasBiomeDependency(packageJson)) return true;

    if (
      (await adapter.folderExists("biome.json")) ||
      (await adapter.folderExists("biome.jsonc")) ||
      (await adapter.folderExists(".biome.json")) ||
      (await adapter.folderExists(".biome.jsonc"))
    ) {
      return true;
    }

    return (await adapter.findFiles(BIOME_CONFIG_BASENAMES)).length > 0;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const configFiles = await adapter.findFiles(BIOME_CONFIG_BASENAMES);
      const hasConfig = configFiles.length > 0;
      const dependencyDeclared = hasBiomeDependency(packageJson);
      let hasScriptInvocation = false;

      // Every discovered config is an executable tool input, including nested
      // monorepo configs that ordinary source scanning would leave unreachable.
      for (const configFile of configFiles) {
        adapter.markAsUsed(configFile);
      }

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isBiomeScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      if ((hasConfig || hasScriptInvocation) && dependencyDeclared) {
        adapter.markPackageAsUsed(BIOME_PACKAGE);
      }

      if ((hasConfig || hasScriptInvocation) && !dependencyDeclared) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Biome configuration or command found, but '@biomejs/biome' is not listed in package.json.",
          evidence: { configFiles, hasScriptInvocation },
        });
      }

      // Static JSON configs let us preserve the referenced local config and Grit
      // plugin files. Dynamic execution is deliberately avoided by the loader.
      for (const configFile of configFiles) {
        const loaded = await loadStaticPluginConfig(adapter, [configFile]);
        if (!loaded) continue;

        for (const extension of stringArray(loaded.config.extends)) {
          const resolved = resolveRelativeConfigPath(configFile, extension);
          if (resolved) adapter.markAsUsed(resolved);
          else if (extension && extension !== "//") {
            adapter.markPackageAsUsed(extension.split("/").slice(0, extension.startsWith("@") ? 2 : 1).join("/"));
          }
        }

        for (const plugin of stringArray(loaded.config.plugins)) {
          const resolved = resolveRelativeConfigPath(configFile, plugin);
          if (resolved) adapter.markAsUsed(resolved);
          else if (plugin) {
            adapter.markPackageAsUsed(plugin.split("/").slice(0, plugin.startsWith("@") ? 2 : 1).join("/"));
          }
        }

        for (const plugin of Array.isArray(loaded.config.plugins) ? loaded.config.plugins : []) {
          const descriptor = stringRecord(plugin);
          const pluginPath = typeof descriptor.path === "string" ? descriptor.path : undefined;
          if (!pluginPath) continue;
          const resolved = resolveRelativeConfigPath(configFile, pluginPath);
          if (resolved) adapter.markAsUsed(resolved);
        }

        // Biome's `files.includes` paths are relative to the config file. They
        // describe tool scope, not runtime entry points, so register them as
        // project patterns rather than incorrectly making every matching file public.
        const files = stringRecord(loaded.config.files);
        const includes = stringArray(files.includes).map((pattern) => {
          const directory = directoryOf(configFile);
          return directory ? `${directory}/${pattern}` : pattern;
        });
        if (includes.length > 0) adapter.addProjectPatterns(includes);
      }
    },

    onFileStart: (fileId, adapter) => {
      if (BIOME_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default BiomePlugin;
