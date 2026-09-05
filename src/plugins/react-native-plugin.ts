import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const REACT_NATIVE_CONFIG_FILES = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
  "metro.config.ts",
  "react-native.config.js",
  "react-native.config.ts",
];

const REACT_NATIVE_ENTRY_FILES = [
  "index.js",
  "index.ts",
  "index.tsx",
  "index.jsx",
  "App.js",
  "App.tsx",
  "App.jsx",
];

const REACT_NATIVE_PACKAGES = [
  "react-native",
  "@react-native/babel-preset",
  "@react-native/metro-config",
  "@react-native-community/cli",
];

/**
 * Helper to check if an app.json is a standard bare React Native config
 * (e.g., contains "name" or "displayName" without being an Expo config).
 */
function isBareReactNativeAppJson(appJsonData: any): boolean {
  return (
    appJsonData &&
    typeof appJsonData === "object" &&
    !appJsonData.expo &&
    (typeof appJsonData.name === "string" || typeof appJsonData.displayName === "string")
  );
}

export const ReactNativePlugin: AnalyzerPlugin = {
  name: "react-native-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const allDeps = {
      ...pkg?.dependencies,
      ...pkg?.devDependencies,
      ...pkg?.peerDependencies,
    };
    const hasReactNativeDependency = REACT_NATIVE_PACKAGES.some((pkgName) => pkgName in allDeps);
    const hasUniqueConfig = (
      await Promise.all(
        REACT_NATIVE_CONFIG_FILES.filter((file) => file.startsWith("react-native.config")).map(
          (file) => adapter.folderExists(file),
        ),
      )
    ).some(Boolean);
    const hasNativePlatform =
      (await adapter.folderExists("android")) || (await adapter.folderExists("ios"));
    const hasMetroConfig = (
      await Promise.all(
        REACT_NATIVE_CONFIG_FILES.filter((file) => file.startsWith("metro.config")).map((file) =>
          adapter.folderExists(file),
        ),
      )
    ).some(Boolean);
    const hasBareManifest =
      (await adapter.folderExists("app.json")) &&
      isBareReactNativeAppJson(await adapter.readJson("app.json"));

    // app.config.* is deliberately not React Native evidence: it is shared by
    // Expo and Nuxt. The generic `name` field in app.json is also insufficient:
    // it must appear together with native platform directories. A dependency is
    // corroborating evidence only, never proof by itself.
    if (hasUniqueConfig) return true;
    return (
      hasReactNativeDependency &&
      (hasMetroConfig || hasNativePlatform || (hasBareManifest && hasNativePlatform))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      adapter.declareFramework("react-native");

      // 1. Protect React Native configuration files
      for (const configFile of REACT_NATIVE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 2. Protect app.json if it exists and is a valid React Native config
      if (await adapter.folderExists("app.json")) {
        const appJsonData = await adapter.readJson("app.json");
        if (isBareReactNativeAppJson(appJsonData)) {
          adapter.markAsUsed("app.json");
        }
      }

      // 3. Protect default React Native entry points
      for (const entryFile of REACT_NATIVE_ENTRY_FILES) {
        if (await adapter.folderExists(entryFile)) {
          adapter.markAsUsed(entryFile);
        }
      }

      // 4. Retain React Native dependencies
      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "react-native" ||
            depName.startsWith("@react-native/") ||
            depName.startsWith("@react-native-community/")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (
        REACT_NATIVE_CONFIG_FILES.includes(basename) ||
        REACT_NATIVE_ENTRY_FILES.includes(basename)
      ) {
        adapter.markAsUsed(fileId);
      }

      // Protect native android/ios folders or asset folders if scanned
      if (
        normalized.includes("/android/") ||
        normalized.includes("/ios/") ||
        normalized.includes("/assets/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect index.js for AppRegistry.registerComponent('Main', () => App)
      if (REACT_NATIVE_ENTRY_FILES.includes(basename)) {
        if (
          t.isCallExpression(node) &&
          t.isMemberExpression(node.callee) &&
          t.isIdentifier(node.callee.object) &&
          node.callee.object.name === "AppRegistry" &&
          t.isIdentifier(node.callee.property) &&
          node.callee.property.name === "registerComponent"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("react-native");
        }
      }

      // Inspect metro.config.js / app.config.js AST
      if (
        basename.startsWith("metro.config.") ||
        basename.startsWith("app.config.") ||
        basename.startsWith("react-native.config.")
      ) {
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
      }
    },
  },
};

export default ReactNativePlugin;
