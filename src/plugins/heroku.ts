import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

/**
 * Recognized Heroku configuration and manifest files
 */
const HEROKU_CONFIG_FILES = [
  "Procfile",
  "Procfile.dev",
  "Procfile.options",
  "static.json",
  "heroku.yml",
];

const HEROKU_PACKAGES = ["heroku", "heroku-cli", "@heroku-cli/command"];

/**
 * Helper to check if an app.json is specifically a Heroku App Manifest.
 * Validates top-level Heroku keys while ensuring absence of Expo's "expo" object.
 */
function isHerokuAppJson(appJsonData: any): boolean {
  if (!appJsonData || typeof appJsonData !== "object" || appJsonData.expo) {
    return false;
  }

  // Common keys in a Heroku app.json manifest
  const herokuKeys = ["buildpacks", "formation", "addons", "environments", "stack"];

  const hasHerokuKey = herokuKeys.some((key) => key in appJsonData);

  // Checks for Heroku postdeploy / predeploy script hooks inside app.json
  const hasHerokuScripts =
    appJsonData.scripts &&
    typeof appJsonData.scripts === "object" &&
    ("postdeploy" in appJsonData.scripts || "prereceive" in appJsonData.scripts);

  return hasHerokuKey || Boolean(hasHerokuScripts);
}

/**
 * Helper to parse Heroku app.json buildpacks and scripts
 */
function processHerokuConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process buildpacks array (e.g., "buildpacks": [{ "url": "heroku/nodejs" }])
  if (Array.isArray(config.buildpacks)) {
    for (const bp of config.buildpacks) {
      if (typeof bp === "object" && bp !== null && typeof bp.url === "string") {
        if (bp.url.startsWith(".") || bp.url.startsWith("/")) {
          adapter.markAsUsed(bp.url);
        }
      }
    }
  }

  // Process Heroku manifest scripts hooks (postdeploy, predeploy)
  if (config.scripts && typeof config.scripts === "object") {
    for (const [scriptName, scriptContent] of Object.entries(config.scripts)) {
      if (typeof scriptContent === "string") {
        adapter.markAsUsed("app.json", `scripts:${scriptName}`);
      }
    }
  }
}

export const HerokuPlugin: AnalyzerPlugin = {
  name: "heroku-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for Heroku Procfile or heroku.yml
    for (const configFile of HEROKU_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check app.json specifically for Heroku manifest properties
    if (await adapter.folderExists("app.json")) {
      const appJson = await adapter.readJson("app.json");
      if (isHerokuAppJson(appJson)) return true;
    }

    // 3. Check package.json for Heroku CLI dependencies or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (HEROKU_PACKAGES.some((p) => p in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bheroku\b/.test(s) || s.includes("heroku local")),
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated Heroku configuration files
      for (const configFile of HEROKU_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 2. Protect app.json ONLY if it matches the Heroku manifest schema
      if (await adapter.folderExists("app.json")) {
        const appJsonData = await adapter.readJson("app.json");
        if (isHerokuAppJson(appJsonData)) {
          adapter.markAsUsed("app.json");
          processHerokuConfig(appJsonData, adapter);
        }
      }

      if (pkg) {
        // 3. Protect Heroku package dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "heroku" ||
            depName.startsWith("@heroku-cli/") ||
            depName === "heroku-cli"
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Mark scripts executing heroku CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bheroku\b/.test(scriptContent) || scriptContent.includes("heroku local"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Procfile, Procfile.dev, static.json, heroku.yml
      if (HEROKU_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },
  },
};

export default HerokuPlugin;
