import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const EXPRESSIVE_CODE_CONFIG_FILES = [
  "ec.config.mjs",
  "ec.config.js",
  "ec.config.ts",
  "ec.config.cjs",
  "expressive-code.config.mjs",
  "expressive-code.config.js",
  "expressive-code.config.ts",
];

function isExpressiveCodePackage(source: string): boolean {
  return (
    source === "expressive-code" ||
    source.startsWith("@expressive-code/") ||
    source === "astro-expressive-code" ||
    source === "remark-expressive-code"
  );
}

/**
 * Extracts plugins and themes passed as package name string literals inside AST objects
 */
function extractConfigProperties(objectExpr: any, adapter: any): void {
  if (!t.isObjectExpression(objectExpr)) return;

  for (const prop of objectExpr.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const keyName = prop.key?.name || prop.key?.value;

    // 1. Process plugins: [ 'expressive-code-plugin-foo' ]
    if (keyName === "plugins" && t.isArrayExpression(prop.value)) {
      for (const el of prop.value.elements) {
        if (t.isStringLiteral(el) && !el.value.startsWith(".") && !el.value.startsWith("/")) {
          adapter.markPackageAsUsed(el.value);
        }
      }
    }

    // 2. Process themes: 'dracula' | ['dracula', 'nord']
    if (keyName === "themes") {
      if (
        t.isStringLiteral(prop.value) &&
        !prop.value.value.startsWith(".") &&
        !prop.value.value.startsWith("/")
      ) {
        adapter.markPackageAsUsed(prop.value.value);
      } else if (t.isArrayExpression(prop.value)) {
        for (const el of prop.value.elements) {
          if (t.isStringLiteral(el) && !el.value.startsWith(".") && !el.value.startsWith("/")) {
            adapter.markPackageAsUsed(el.value);
          }
        }
      }
    }
  }
}

export const ExpressiveCodePlugin: AnalyzerPlugin = {
  name: "expressive-code-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    // 1. Check for dedicated Expressive Code config files
    for (const configFile of EXPRESSIVE_CODE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for Expressive Code dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => isExpressiveCodePackage(dep))) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated Expressive Code config files
      for (const configFile of EXPRESSIVE_CODE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (isExpressiveCodePackage(depName)) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (EXPRESSIVE_CODE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = EXPRESSIVE_CODE_CONFIG_FILES.includes(basename);

      // 1. Process non-relative imports / requires inside config files
      if (isConfigFile) {
        if (t.isImportDeclaration(node)) {
          const source = node.source.value;
          if (source && !source.startsWith(".") && !source.startsWith("/")) {
            adapter.markPackageAsUsed(source);
            adapter.markAsUsed(fileId);
          }
        }

        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "require"
        ) {
          const arg = node.arguments[0];
          if (t.isStringLiteral(arg) && !arg.value.startsWith(".") && !arg.value.startsWith("/")) {
            adapter.markPackageAsUsed(arg.value);
            adapter.markAsUsed(fileId);
          }
        }

        // Export default defineEcConfig({ ... })
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          if (t.isCallExpression(node.declaration) && node.declaration.arguments[0]) {
            extractConfigProperties(node.declaration.arguments[0], adapter);
          } else if (t.isObjectExpression(node.declaration)) {
            extractConfigProperties(node.declaration, adapter);
          }
        }

        // CJS module.exports = { ... }
        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          extractConfigProperties(node.right, adapter);
        }
      }

      // 2. Detect astroExpressiveCode({ ... }) / remarkExpressiveCode({ ... }) calls
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const calleeName = node.callee.name;

        if (calleeName === "astroExpressiveCode") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("astro-expressive-code");
          if (node.arguments[0]) extractConfigProperties(node.arguments[0], adapter);
        } else if (calleeName === "remarkExpressiveCode") {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("remark-expressive-code");
          if (node.arguments[0]) extractConfigProperties(node.arguments[0], adapter);
        }
      }

      // 3. Retain Expressive Code package imports across any file
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source && isExpressiveCodePackage(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default ExpressiveCodePlugin;
