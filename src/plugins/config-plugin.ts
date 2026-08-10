/**
 * config-plugin.ts
 *
 * This plugin is intentionally a no-op stub.
 *
 * Configuration for OptiPrune (optiprune.json, optiprune.jsonc,
 * optiprune.config.{ts,js,mjs}, package.json#optiprune) is now loaded
 * **before** the plugin engine runs, directly inside `loadConfig()` in
 * `config-loader.ts`.  Loading config inside a plugin was unreliable because
 * plugin `onProjectInit` hooks execute after file discovery, meaning that
 * `ignore`, `extensions`, and `plugins` overrides from the config file had
 * no effect on which files were scanned.
 *
 * The stub is kept here so that any external code that imports
 * `CustomConfigPlugin` by name continues to compile without errors.
 */

import type { AnalyzerPlugin } from "../types.js";

export const CustomConfigPlugin: AnalyzerPlugin = {
  name: "custom-config-plugin",
  version: "2.0.0",

  // Never auto-detect: config loading is handled by the core loader.
  detect: async () => false,

  lifecycle: {
    // All hooks are intentionally empty.
  },
};

export default CustomConfigPlugin;
