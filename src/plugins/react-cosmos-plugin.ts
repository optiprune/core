import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized React Cosmos configuration files
 */
const COSMOS_CONFIG_FILES = [
  "cosmos.config.json",
  "cosmos.config.js",
  "cosmos.config.cjs",
  "cosmos.config.mjs",
  "cosmos.config.ts",
  "cosmos.decorator.js",
  "cosmos.decorator.jsx",
  "cosmos.decorator.ts",
  "cosmos.decorator.tsx"
];

const COSMOS_PACKAGES = [
  "react-cosmos",
  "react-cosmos-plugin-webpack",
  "react-cosmos-plugin-vite",
  "react-cosmos-dom",
  "react-cosmos-core"
];

/**
 * Helper to process Cosmos config object parameters
 */
function processCosmosConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process plugins list
  if (config.plugins && Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      if (typeof plugin === "string") {
        adapter.markPackageAsUsed(plugin);
      }
    }
  }

  // Process user imports / global imports if specified
  if (config.globalImports && Array.isArray(config.globalImports)) {
    for (const imp of config.globalImports) {
      if (typeof imp === "string" && !imp.includes("*")) {
        if (!imp.startsWith(".") && !imp.startsWith("/")) {
          const pkgName = imp.startsWith("@")
            ? imp.split("/").slice(0, 2).join("/")
            : imp.split("/")[0];
          if (pkgName) adapter.markPackageAsUsed(pkgName);
        } else {
          adapter.markAsUsed(imp);
        }
      }
    }
  }
}

export const ReactCosmosPlugin: AnalyzerPlugin = {
  name: "react-cosmos-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Cosmos config files or fixture directories
    for (const configFile of COSMOS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    if (
      (await adapter.folderExists("__fixtures__")) ||
      (await adapter.folderExists("cosmos"))
    ) {
      return true;
    }

    // 2. Check package.json for dependencies, inline config, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.cosmos) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (COSMOS_PACKAGES.some((p) => p in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && /\bcosmos\b/.test(s)
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

      // 1. Protect dedicated configuration & decorator files
      for (const configFile of COSMOS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect react-cosmos core and ecosystem plugins in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "react-cosmos" ||
            depName.startsWith("react-cosmos-") ||
            depName.includes("/react-cosmos-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }

        // 3. Process inline package.json#cosmos configuration block
        if (pkg.cosmos) {
          adapter.markAsUsed("package.json", "cosmos");
          processCosmosConfig(pkg.cosmos, adapter);
        }

        // 4. Mark scripts executing react-cosmos CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              /\bcosmos\b/.test(scriptContent)
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config if present
      if (await adapter.folderExists("cosmos.config.json")) {
        const configData = await adapter.readJson("cosmos.config.json");
        if (configData) {
          processCosmosConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration & decorator files
      if (COSMOS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }

      // Protect React Cosmos fixture files and __fixtures__ folders
      if (
        normalized.includes("__fixtures__") ||
        normalized.includes("/fixtures/") ||
        /\.fixture\.[jt]sx?$/.test(basename) ||
        /\.fixture\.mdx$/.test(basename) ||
        basename.startsWith("cosmos.decorator.")
      ) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. AST Inspection for JS/TS config files
      if (
        basename.startsWith("cosmos.config.") &&
        (basename.endsWith(".js") ||
          basename.endsWith(".cjs") ||
          basename.endsWith(".mjs") ||
          basename.endsWith(".ts"))
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

        // Extract plugin dependencies from AST (e.g. plugins: ['react-cosmos-plugin-vite'])
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "plugins"
        ) {
          if (t.isArrayExpression(node.value)) {
            for (const el of node.value.elements) {
              if (t.isStringLiteral(el)) {
                adapter.markPackageAsUsed(el.value);
              }
            }
          }
        }
      }

      // 2. AST Inspection inside Fixture Files (*.fixture.tsx)
      if (
        normalized.includes("__fixtures__") ||
        /\.fixture\.[jt]sx?$/.test(basename)
      ) {
        // Mark export default inside fixtures
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Mark named exports inside multi-fixture files (export const Primary = ...)
        if (t.isExportNamedDeclaration(node) && node.declaration) {
          if (t.isVariableDeclaration(node.declaration)) {
            for (const decl of node.declaration.declarations) {
              if (t.isVariableDeclarator(decl) && t.isIdentifier(decl.id)) {
                adapter.markAsUsed(fileId, decl.id.name);
              }
            }
          }
        }
      }
    }
  }
};

export default ReactCosmosPlugin;