import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized FAST configuration and manifest files
 */
const FAST_CONFIG_FILES = ["custom-elements.json", "fast-cli.config.json", ".fast-cli.json"];

/**
 * Helper to check if an import source is part of the Microsoft FAST ecosystem
 */
function isFastPackage(source: string): boolean {
  return (
    source.startsWith("@microsoft/fast-") ||
    source === "@microsoft/fast-element" ||
    source === "@microsoft/fast-foundation" ||
    source === "@microsoft/fast-components" ||
    source.startsWith("@fluentui/fast-") ||
    source === "@fluentui/web-components"
  );
}

export const FastPlugin: AnalyzerPlugin = {
  name: "fast-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated FAST config files
    for (const configFile of FAST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for FAST dependencies
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => isFastPackage(dep))) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect configuration files
      for (const configFile of FAST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect all @microsoft/fast-* and @fluentui/fast-* packages
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (isFastPackage(depName)) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (FAST_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      // 1. Inspect AST for FAST imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (isFastPackage(source)) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect @customElement('my-element') class decorator
      if (t.isClassDeclaration(node)) {
        const decorators = (node as any).decorators;
        if (decorators && Array.isArray(decorators)) {
          for (const decorator of decorators) {
            const expr = decorator.expression;
            let decoratorName = "";

            if (t.isCallExpression(expr) && t.isIdentifier(expr.callee)) {
              decoratorName = expr.callee.name;
            } else if (t.isIdentifier(expr)) {
              decoratorName = expr.name;
            }

            if (decoratorName === "customElement") {
              adapter.markAsUsed(fileId);
              if (node.id) {
                adapter.markAsUsed(fileId, node.id.name);
              }
              adapter.markPackageAsUsed("@microsoft/fast-element");
            }
          }
        }

        // Detect class extending FASTElement
        const superClass = (node as any).superClass;
        if (
          superClass &&
          t.isIdentifier(superClass) &&
          ["FASTElement", "FoundationElement"].includes(superClass.name)
        ) {
          adapter.markAsUsed(fileId);
          if (node.id) {
            adapter.markAsUsed(fileId, node.id.name);
          }
          adapter.markPackageAsUsed("@microsoft/fast-element");
        }
      }

      // 3. Detect FASTElement.define(MyElement) or MyElement.define() call expressions
      if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        const prop = node.callee.property;

        if (t.isIdentifier(prop) && prop.name === "define" && t.isIdentifier(obj)) {
          if (obj.name === "FASTElement") {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@microsoft/fast-element");
            if (node.arguments[0] && t.isIdentifier(node.arguments[0])) {
              adapter.markAsUsed(fileId, node.arguments[0].name);
            }
          }
        }
      }
    },
  },
};

export default FastPlugin;
