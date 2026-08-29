import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ROUTER_PACKAGES = [
  "@react-navigation/native",
  "@react-navigation/stack",
  "@react-navigation/bottom-tabs",
  "@react-navigation/drawer",
  "@react-navigation/native-stack",
  "expo-router",
];

export const ReactNativeRouterPlugin: AnalyzerPlugin = {
  name: "react-native-router-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (!pkg) return false;

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    // Strictly check if navigation or expo-router packages exist in package.json
    return ROUTER_PACKAGES.some((p) => p in allDeps);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        // Retain navigation packages
        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@react-navigation/") || depName === "expo-router") {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Expo Router File-Based Route Convention (e.g. /app/_layout.tsx, /app/index.tsx)
      if (normalized.includes("/app/") || normalized.startsWith("app/")) {
        if (
          basename.startsWith("_layout.") ||
          basename.startsWith("+") ||
          basename.startsWith("index.") ||
          /\.[jt]sx?$/.test(basename)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("expo-router");
        }
      }

      // React Navigation Screen conventions
      if (
        normalized.includes("/screens/") ||
        normalized.includes("/navigation/") ||
        normalized.includes("/navigators/")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // 1. Expo Router Screen / Layout AST exports
      if (normalized.includes("/app/") || normalized.startsWith("app/")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }
      }

      // 2. React Navigation JSX Screen Component Mapping: <Stack.Screen name="Home" component={HomeScreen} />
      if (t.isJSXElement(node) && node.openingElement) {
        const elementName = node.openingElement.name;

        if (elementName?.type === "JSXMemberExpression") {
          if (t.isJSXIdentifier(elementName.property) && elementName.property.name === "Screen") {
            for (const attr of node.openingElement.attributes) {
              if (
                t.isJSXAttribute(attr) &&
                t.isJSXIdentifier(attr.name) &&
                attr.name.name === "component"
              ) {
                if (
                  attr.value &&
                  attr.value.type === "JSXExpressionContainer" &&
                  t.isIdentifier(attr.value.expression)
                ) {
                  adapter.markAsUsed(fileId, attr.value.expression.name);
                }
              }
            }
          }
        }
      }
    },
  },
};

export default ReactNativeRouterPlugin;
