import { AnalyzerPlugin, PluginAdapter } from "../types.js";

const CONFIG_FILES = ["optiprune.json", "optiprune.jsonc"];

/**
 * Interface representing the structure of optiprune.json / optiprune.jsonc
 */
export interface OptiPruneUserConfig {
  rootDir?: string;
  entry?: string[];
  extensions?: string[];
  ignore?: string[];
  externalContracts?: string[];
  reportUnusedExports?: boolean;
  includeConventionalEntries?: boolean;
  failOn?: "high" | "medium" | "low" | "info" | "none";
  layers?: {
    smtTimeoutMs?: number;
    isolateMemoryLimitMb?: number;
    enableConcolicProof?: boolean;
    skip3?: boolean;
    skip4?: boolean;
  };
  rules?: Record<string, "error" | "warning" | "off">;
  verbose?: boolean;
  json?: boolean;
}

/**
 * Utility to strip comments (// and /* ... *\/) and trailing commas from JSONC content
 * before passing it to standard JSON.parse().
 */
function parseJsonc<T = any>(jsoncContent: string): T {
  const cleanJson = jsoncContent
    // Remove single-line comments: // ...
    .replace(/\/\/.*/g, "")
    // Remove multi-line comments: /* ... */
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Remove trailing commas before closing braces/brackets
    .replace(/,(\s*[\]}])/g, "$1");

  return JSON.parse(cleanJson);
}

export const CustomConfigPlugin: AnalyzerPlugin = {
  name: "custom-config-plugin",
  version: "1.0.0",

  /**
   * Detects if optiprune.json or optiprune.jsonc exists in the project root.
   */
  detect: async (adapter) => {
    for (const configFile of CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) {
        return true;
      }
    }

    // Also check if package.json contains an "optiprune" property
    const pkg = await adapter.readJson("package.json");
    if (pkg?.optiprune) {
      return true;
    }

    return false;
  },

  lifecycle: {
    /**
     * Reads, parses, and applies the custom config settings during project initialization.
     */
    onProjectInit: async (adapter: PluginAdapter) => {
      let config: OptiPruneUserConfig | null = null;
      let activeConfigFile: string | null = null;

      // 1. Try reading optiprune.json or optiprune.jsonc
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
                configFile: file
            }
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

      // 3. Process and apply `entry` points
      if (Array.isArray(config.entry)) {
        for (const entryPath of config.entry) {
          if (typeof entryPath === "string") {
            adapter.markAsUsed(entryPath);
          }
        }
      }

      // 4. Process and protect `externalContracts`
      if (Array.isArray(config.externalContracts)) {
        for (const contractSymbol of config.externalContracts) {
          if (typeof contractSymbol === "string" && activeConfigFile) {
            // Mark symbol globally as used so Layer 6 propagation ignores unused warnings
            adapter.markAsUsed(activeConfigFile, contractSymbol);
          }
        }
      }

      // 5. Apply rule severity overrides (if custom rule config exists)
      if (config.rules && typeof config.rules === "object") {
        for (const [ruleName, severity] of Object.entries(config.rules)) {
          if (["error", "warning", "off"].includes(severity)) {
            // Attach rule configuration state
            adapter.attachMetadata(
              { type: "ConfigOverride" },
              `rule:${ruleName}`,
              severity
            );
          }
        }
      }

      // 6. Attach advanced engine layer settings as metadata for OptiPrune execution layers
      if (config.layers && typeof config.layers === "object") {
        adapter.attachMetadata(
          { type: "EngineLayers" },
          "layersConfig",
          config.layers
        );
      }
    },

    /**
     * Inspects every file against user-defined ignore patterns and extensions.
     */
    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Automatically safeguard configuration file instances
      if (CONFIG_FILES.some((cfg) => normalized.endsWith(cfg))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default CustomConfigPlugin;