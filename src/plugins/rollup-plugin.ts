import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Rollup Plugin
 * Handles Rollup-specific patterns: rollup.config.js/.ts, entry points, output options, plugins.
 */
export const RollupPlugin: AnalyzerPlugin = {
  name: "rollup-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const hasDep = !!(pkg.dependencies?.["rollup"] || pkg.devDependencies?.["rollup"]);
      if (hasDep) return true;
    }
    const configFiles = [
      "rollup.config.js",
      "rollup.config.mjs",
      "rollup.config.ts",
      "rollup.config.cjs"
    ];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: async (fileId, adapter) => {
      const rollupConfigFiles = [
        "rollup.config.js",
        "rollup.config.mjs",
        "rollup.config.ts",
        "rollup.config.cjs"
      ];
      if (rollupConfigFiles.some(file => fileId.endsWith(file))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (fileId.includes("rollup.config.")) {
        // Look for export default { ... } or module.exports = { ... }
        let configNode = null;
        if (t.isExportDefaultDeclaration(node) && (t.isObjectExpression(node.declaration) || t.isArrayExpression(node.declaration))) {
          configNode = node.declaration;
        } else if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left) && t.isIdentifier(node.left.object) && node.left.object.name === "module" && t.isIdentifier(node.left.property) && node.left.property.name === "exports") {
          if (t.isObjectExpression(node.right) || t.isArrayExpression(node.right)) {
            configNode = node.right;
          }
        }

        if (configNode) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;
            for (const prop of objExpr.properties) {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                const keyName = prop.key.name;

                // Handle 'input' (entry points)
                if (keyName === "input") {
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
                if (keyName === "output") {
                  const outVal = prop.value;
                  const processOutputObj = (o: any) => {
                    if (t.isObjectExpression(o)) {
                      o.properties.forEach(op => {
                        if (t.isObjectProperty(op) && t.isIdentifier(op.key) && op.key.name === "dir" && t.isStringLiteral(op.value)) {
                          adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, op.value.value));
                        }
                      });
                    }
                  };
                  if (t.isObjectExpression(outVal)) {
                    processOutputObj(outVal);
                  } else if (t.isArrayExpression(outVal)) {
                    outVal.elements.forEach(el => processOutputObj(el));
                  }
                }

                // Handle 'plugins'
                if (keyName === "plugins" && t.isArrayExpression(prop.value)) {
                  prop.value.elements.forEach(pluginExpr => {
                    if (t.isCallExpression(pluginExpr) && t.isIdentifier(pluginExpr.callee)) {
                      adapter.markAsUsed(fileId);
                    }
                  });
                }
              }
            }
          };

          if (t.isArrayExpression(configNode)) {
            configNode.elements.forEach(el => processObject(el));
          } else {
            processObject(configNode);
          }
        }
      }

      // Detect Rollup plugin creation patterns (e.g., export default function myPlugin() { return { name: '...' } })
      if (t.isObjectExpression(node)) {
        const hasPluginKeys = node.properties.some((p: any) => t.isObjectProperty(p) && t.isIdentifier(p.key) && ["name", "resolveId", "load", "transform", "buildStart"].includes(p.key.name));
        if (hasPluginKeys && (fileId.includes("plugin") || fileId.includes("rollup"))) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default RollupPlugin;
