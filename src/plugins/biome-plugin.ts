import { AnalyzerPlugin } from "../types.js";

const BIOME_CONFIG_FILES = ["biome.json", "biome.jsonc"];
const BIOME_PACKAGES = ["@biomejs/biome"];

export const BiomePlugin: AnalyzerPlugin = {
  name: "biome-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (BIOME_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of BIOME_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasBiomeDep = BIOME_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of BIOME_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // Mark @biomejs/biome package as used if installed
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Mark package.json scripts that execute biome (e.g., "lint": "biome check ./src")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("biome ") || scriptContent.includes("biome"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // Report missing dependency finding if config exists but package is missing
      if (hasConfigFile && !hasBiomeDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Biome configuration found but '@biomejs/biome' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Mark biome configuration files as used
      if (BIOME_CONFIG_FILES.some((cfg) => normalized.endsWith(cfg))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@biomejs/biome");
      }
    },
  },
};

export default BiomePlugin;