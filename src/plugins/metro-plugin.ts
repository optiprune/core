import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const METRO_CONFIG_FILES = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
  "metro.config.ts",
  "metro.config.json"
];

const METRO_PACKAGES = [
  "metro",
  "metro-config",
  "@react-native/metro-config",
  "@expo/metro-config",
  "react-native"
];

export const MetroPlugin: AnalyzerPlugin = {
  name: "metro-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (METRO_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of METRO_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasMetroDep = METRO_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of METRO_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
          break;
        }
      }

      // Mark installed Metro/React Native packages as used in package.json
      if (hasMetroDep) {
        for (const metroPkg of METRO_PACKAGES) {
          if (allDeps[metroPkg]) {
            adapter.markPackageAsUsed(metroPkg);
          }
        }
      }

      // Track npm scripts invoking Metro or React Native CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("metro") ||
              scriptContent.includes("react-native start") ||
              scriptContent.includes("expo start"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasMetroDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Metro configuration found but 'metro' or 'react-native' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Mark Metro configuration files
      if (METRO_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("metro");
      }

      // 2. Mark React Native & Expo standard entry points
      const entryPoints = [
        "index.js",
        "index.ts",
        "index.jsx",
        "index.tsx",
        "App.js",
        "App.ts",
        "App.jsx",
        "App.tsx",
        "index.share.js",
        "index.android.js",
        "index.ios.js"
      ];

      if (entryPoints.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = METRO_CONFIG_FILES.includes(basename);

      // 1. Detect Metro configuration exports
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Handle CJS module.exports = ...
        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          (node.left as any).object?.name === "module" &&
          (node.left as any).property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect Metro & React Native package imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "metro" ||
          source.startsWith("metro-") ||
          source.includes("metro-config") ||
          source === "react-native"
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect AppRegistry.registerComponent('...', () => App)
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        const prop = node.callee.property;

        if (
          t.isIdentifier(obj) &&
          obj.name === "AppRegistry" &&
          t.isIdentifier(prop) &&
          prop.name === "registerComponent"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("react-native");
        }
      }
    }
  }
};

export default MetroPlugin;