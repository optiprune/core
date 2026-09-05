import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized Expo configuration and manifest files
 */
const EXPO_CONFIG_FILES = [
  "app.config.js",
  "app.config.ts",
  "app.config.mjs",
  "app.config.cjs",
  "eas.json",
  "expo-env.d.ts",
];

const EXPO_CORE_PACKAGES = [
  "expo",
  "expo-status-bar",
  "expo-splash-screen",
  "expo-updates",
  "expo-constants",
  "expo-linking",
  "expo-router",
  "expo-font",
  "expo-asset",
  "@expo/config",
  "@expo/config-plugins",
  "@expo/metro-config",
  "@expo/vector-icons",
];

/**
 * Helper to process Expo Config Plugins declared inside app.json / app.config
 */
function processExpoPlugins(plugins: unknown, adapter: any): void {
  if (!plugins || !Array.isArray(plugins)) return;

  for (const plugin of plugins) {
    let pluginName: string | null = null;

    if (typeof plugin === "string") {
      pluginName = plugin;
    } else if (Array.isArray(plugin) && typeof plugin[0] === "string") {
      pluginName = plugin[0];
    }

    if (pluginName) {
      if (!pluginName.startsWith(".") && !pluginName.startsWith("/")) {
        adapter.markPackageAsUsed(pluginName);
      } else {
        adapter.markAsUsed(pluginName);
      }
    }
  }
}

/**
 * Helper to process Expo app configuration objects.
 * Strictly verifies the presence of the `expo` field or valid Expo structure.
 */
function processExpoConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // STRICT GUARD: If config is from app.json, it MUST have an "expo" object.
  // If it's from app.config.js/ts, config itself is the expo object or wraps "expo".
  const expoObj = config.expo ?? (config.name || config.slug ? config : null);

  if (!expoObj || typeof expoObj !== "object") return;

  // 1. Extract entry points (e.g., "entryPoint": "./src/App.tsx")
  if (typeof expoObj.entryPoint === "string") {
    adapter.markAsUsed(expoObj.entryPoint);
  }

  // 2. Extract Config Plugins (e.g., "plugins": ["expo-router", "expo-camera"])
  if (expoObj.plugins) {
    processExpoPlugins(expoObj.plugins, adapter);
  }

  // 3. Extract asset paths
  if (typeof expoObj.icon === "string") {
    adapter.markAsUsed(expoObj.icon);
  }
}

/**
 * Helper to check if an app.json file is specifically an Expo configuration.
 */
function isExpoAppJson(appJsonData: any): boolean {
  return (
    appJsonData &&
    typeof appJsonData === "object" &&
    typeof appJsonData.expo === "object" &&
    appJsonData.expo !== null
  );
}

export const ExpoPlugin: AnalyzerPlugin = {
  name: "expo-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    const hasExpoDependency = Object.keys(allDeps).some(
      (dep) => dep === "expo" || dep.startsWith("expo-") || dep.startsWith("@expo/"),
    );
    const hasExpoScript = Object.values(pkg?.scripts ?? {}).some(
      (script) =>
        typeof script === "string" &&
        /(?:^|\s)(?:pnpm\s+exec\s+|yarn\s+|bunx\s+|npx\s+)?(?:expo|eas)(?:\s|$)/.test(script),
    );

    // An inline Expo block and an app.json with an `expo` object are
    // self-identifying. Shared app.config.* names require corroboration.
    if (pkg?.expo && typeof pkg.expo === "object") return true;
    if (await adapter.folderExists("app.json")) {
      const appJson = await adapter.readJson("app.json");
      if (isExpoAppJson(appJson)) return true;
    }

    const dedicatedConfig = (
      await Promise.all(
        EXPO_CONFIG_FILES.filter((file) => !file.startsWith("app.config")).map((file) =>
          adapter.folderExists(file),
        ),
      )
    ).some(Boolean);
    const sharedAppConfig = (
      await Promise.all(
        EXPO_CONFIG_FILES.filter((file) => file.startsWith("app.config")).map((file) =>
          adapter.folderExists(file),
        ),
      )
    ).some(Boolean);

    if (dedicatedConfig) return true;
    return hasExpoScript || (hasExpoDependency && sharedAppConfig);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      adapter.declareFramework("expo");

      // 1. Protect dedicated Expo configuration files
      for (const configFile of EXPO_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 2. Safely check app.json — mark as used ONLY if it actually contains an `expo` root key
      if (await adapter.folderExists("app.json")) {
        const appJsonData = await adapter.readJson("app.json");
        if (isExpoAppJson(appJsonData)) {
          adapter.markAsUsed("app.json");
          processExpoConfig(appJsonData, adapter);
        }
      }

      if (pkg) {
        // 3. Protect Expo ecosystem packages in package.json dependencies
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === "expo" || depName.startsWith("expo-") || depName.startsWith("@expo/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Process inline package.json#expo config block
        if (pkg.expo) {
          adapter.markAsUsed("package.json", "expo");
          processExpoConfig(pkg.expo, adapter);
        }

        // 5. Mark scripts executing expo or eas CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bexpo\b/.test(scriptContent) || /\beas\b/.test(scriptContent))
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

      // Protect Expo configuration and environment files
      if (EXPO_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }

      // Protect local Expo Config Plugins folder
      if (normalized.includes("/plugins/") || normalized.startsWith("plugins/")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect app.config.js / app.config.ts AST
      if (basename.startsWith("app.config.")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // Extract Config Plugins from AST property array
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "plugins") {
          if (t.isArrayExpression(node.value)) {
            for (const el of node.value.elements) {
              if (t.isStringLiteral(el)) {
                if (!el.value.startsWith(".")) {
                  adapter.markPackageAsUsed(el.value);
                }
              } else if (
                t.isArrayExpression(el) &&
                el.elements[0] &&
                t.isStringLiteral(el.elements[0])
              ) {
                const pluginName = el.elements[0].value;
                if (!pluginName.startsWith(".")) {
                  adapter.markPackageAsUsed(pluginName);
                }
              }
            }
          }
        }
      }
    },
  },
};

export default ExpoPlugin;
