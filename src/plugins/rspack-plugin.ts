import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Rspack Plugin
 * Handles Rspack-specific patterns: rspack.config.js/.ts, entry points, and output options.
 */
export const RspackPlugin: AnalyzerPlugin = {
  name: "rspack-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["@rspack/core"] || pkg.devDependencies?.["@rspack/core"] || pkg.dependencies?.["rspack"] || pkg.devDependencies?.["rspack"]);
      if (hasDep) return true;
    }
    const configFiles = [
      "rspack.config.js",
      "rspack.config.mjs",
      "rspack.config.ts",
      "rspack.config.cjs"
    ];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: async (fileId, adapter) => {
      const rspackConfigFiles = [
        "rspack.config.js",
        "rspack.config.mjs",
        "rspack.config.ts",
        "rspack.config.cjs"
      ];
      if (rspackConfigFiles.some(file => fileId.endsWith(file))) {
        adapter.markAsUsed(fileId);
        adapter.markAsUsed("@rspack/core");
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (fileId.includes("rspack.config.")) {
        let configNode = null;
        if (t.isExportDefaultDeclaration(node) && t.isObjectExpression(node.declaration)) {
          configNode = node.declaration;
        } else if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left) && t.isIdentifier(node.left.object) && node.left.object.name === "module" && t.isIdentifier(node.left.property) && node.left.property.name === "exports") {
          if (t.isObjectExpression(node.right)) {
            configNode = node.right;
          }
        }

        if (configNode) {
          for (const prop of configNode.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
              const keyName = prop.key.name;

              // Handle 'entry'
              if (keyName === "entry") {
                const val = prop.value;
                if (t.isStringLiteral(val)) {
                  adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, val.value));
                } else if (t.isArrayExpression(val)) {
                  val.elements.forEach(el => {
                    if (t.isStringLiteral(el)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, el.value));
                    }
                  });
                } else if (t.isObjectExpression(val)) {
                  val.properties.forEach(entryProp => {
                    if (t.isObjectProperty(entryProp) && t.isStringLiteral(entryProp.value)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, entryProp.value.value));
                    }
                  });
                }
              }

              // Handle 'output'
              if (keyName === "output" && t.isObjectExpression(prop.value)) {
                prop.value.properties.forEach(op => {
                  if (t.isObjectProperty(op) && t.isIdentifier(op.key) && op.key.name === "path" && t.isStringLiteral(op.value)) {
                    adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, op.value.value));
                  }
                });
              }
            }
          }
        }
      }
    }
  }
};

export default RspackPlugin;
