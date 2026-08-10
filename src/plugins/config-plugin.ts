import { AnalyzerPlugin, PluginAdapter, OptiPruneUserConfig } from "../types.js";

const CONFIG_FILES = ["optiprune.json", "optiprune.jsonc"];
/**
 * Utility to strip comments (// and /* ... *\/) and trailing commas from JSONC content
 */
function parseJsonc<T = any>(jsoncContent: string): T {
  const cleanJson = jsoncContent
    .replace(/\/\/.*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[\]}])/g, "$1");

  return JSON.parse(cleanJson);
}

export const CustomConfigPlugin: AnalyzerPlugin = {
  name: "custom-config-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    for (const configFile of CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) {
        return true;
      }
    }

    const pkg = await adapter.readJson("package.json");
    return Boolean(pkg?.optiprune);
  },

  lifecycle: {
    onProjectInit: async (adapter: PluginAdapter) => {
      let config: OptiPruneUserConfig | null = null;
      let activeConfigFile: string | null = null;

      // 1. Read optiprune.json or optiprune.jsonc
      for (const file of CONFIG_FILES) {
        const rawContent = await adapter.readFile(file);
        if (rawContent !== null) {
          try {
            config = parseJsonc<OptiPruneUserConfig>(rawContent);
            activeConfigFile = file;
            adapter.markAsUsed(file);
            break;
          } catch (error: any) {
            adapter.emitFinding({
              rule: "invalid-config",
              severity: "error",
              confidence: "high",
              file,
              message: `Failed to parse ${file}: ${error.message}`,
              evidence: {
                rawError: error.message,
                configFile: file,
              },
            });
            return;
          }
        }
      }

      // 2. Fall back to package.json "optiprune" field
      if (!config) {
        const pkg = await adapter.readJson("package.json");
        if (pkg?.optiprune && typeof pkg.optiprune === "object") {
          config = pkg.optiprune as OptiPruneUserConfig;
          activeConfigFile = "package.json";
          adapter.markAsUsed("package.json", "optiprune");
        }
      }

      if (!config) return;

      // 3. Update active runtime context options
      const options = adapter.getConfig();

      if (config.rootDir) options.rootDir = config.rootDir;
      if (config.failOn) options.failOn = config.failOn;
      if (typeof config.reportUnusedExports === "boolean") {
        options.reportUnusedExports = config.reportUnusedExports;
      }
      if (typeof config.includeConventionalEntries === "boolean") {
        options.includeConventionalEntries = config.includeConventionalEntries;
      }
      if (typeof config.verbose === "boolean") options.verbose = config.verbose;
      if (typeof config.json === "boolean") options.json = config.json;

      if (Array.isArray(config.entry)) {
        options.entry = Array.from(new Set([...options.entry, ...config.entry]));
      }

      if (Array.isArray(config.extensions)) {
        options.extensions = config.extensions;
      }

      if (Array.isArray(config.ignore)) {
        options.ignore = Array.from(new Set([...options.ignore, ...config.ignore]));
      }

      if (Array.isArray(config.externalContracts)) {
        options.externalContracts = Array.from(
          new Set([...options.externalContracts, ...config.externalContracts])
        );
      }

      if (config.layers && typeof config.layers === "object") {
        options.layers = {
          ...options.layers,
          ...config.layers,
        };
      }

      if (config.rules && typeof config.rules === "object") {
        options.rules = {
          ...options.rules,
          ...config.rules,
        };
      }

      // 4. Process entry points & external contracts
      if (Array.isArray(config.entry)) {
        for (const entryPath of config.entry) {
          if (typeof entryPath === "string") {
            adapter.markAsUsed(entryPath);
          }
        }
      }

      if (Array.isArray(config.externalContracts) && activeConfigFile) {
        for (const contractSymbol of config.externalContracts) {
          if (typeof contractSymbol === "string") {
            adapter.markAsUsed(activeConfigFile, contractSymbol);
          }
        }
      }

      // 5. Attach metadata for rules and engine layers
      if (config.rules && typeof config.rules === "object") {
        for (const [ruleName, severity] of Object.entries(config.rules)) {
          if (["error", "warning", "off"].includes(severity)) {
            adapter.attachMetadata(
              { type: "ConfigOverride" },
              `rule:${ruleName}`,
              severity
            );
          }
        }
      }

      if (config.layers && typeof config.layers === "object") {
        adapter.attachMetadata(
          { type: "EngineLayers" },
          "layersConfig",
          config.layers
        );
      }
    },

    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      if (CONFIG_FILES.some((cfg) => normalized.endsWith(cfg))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default CustomConfigPlugin;