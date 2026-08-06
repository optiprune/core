import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

export const WebpackPlugin: AnalyzerPlugin = {
  name: "webpack-plugin",
  version: "1.0.1", // Incrementing version for the update
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    const hasWebpackDep = !!(pkg?.devDependencies?.["webpack"] || pkg?.dependencies?.["webpack"]);
    if (hasWebpackDep) return true;

    // Check for common webpack config files
    const configFiles = [
      "webpack.config.js",
      "webpack.config.mjs",
      "webpack.config.cjs",
      "webpack.config.ts",
      "webpack.config.mts",
      "webpack.config.cts",
    ];
    for (const file of configFiles) {
      if (await adapter.readFile(file)) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: async (fileId, adapter) => {
      const basename = path.basename(fileId);
      // Ignore common non-source files that might be picked up by glob patterns
      if (["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"].includes(basename) || basename.endsWith(".json")) {
        return; // Skip processing for these files
      }

      // Webpack Config itself is an entry point
      if (fileId.includes("webpack.config.")) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      if (fileId.includes("webpack.config.")) {
        // Look for module.exports = { ... } or export default { ... }
        let configObjectNode = null;

        if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left) && t.isIdentifier(node.left.object) && node.left.object.name === "module" && t.isIdentifier(node.left.property) && node.left.property.name === "exports" && t.isObjectExpression(node.right)) {
          configObjectNode = node.right;
        } else if (t.isExportDefaultDeclaration(node) && t.isObjectExpression(node.declaration)) {
          configObjectNode = node.declaration;
        }

        if (configObjectNode) {
          for (const prop of configObjectNode.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
              const propName = prop.key.name;

              // Handle 'entry' property
              if (propName === "entry") {
                const value = prop.value;
                if (t.isStringLiteral(value)) {
                  adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, value.value));
                } else if (t.isArrayExpression(value)) { // entry: ['./src/index.js', './src/another.js']
                  value.elements.forEach(element => {
                    if (t.isStringLiteral(element)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, element.value));
                    }
                  });
                } else if (t.isObjectExpression(value)) { // entry: { app: './src/app.js', admin: './src/admin.js' }
                  value.properties.forEach(entryProp => {
                    if (t.isObjectProperty(entryProp) && t.isStringLiteral(entryProp.value)) {
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, entryProp.value.value));
                    } else if (t.isObjectProperty(entryProp) && t.isArrayExpression(entryProp.value)) {
                      entryProp.value.elements.forEach(element => {
                        if (t.isStringLiteral(element)) {
                          adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, element.value));
                        }
                      });
                    }
                  });
                } else if (t.isCallExpression(value)) { // entry: () => './src/index.js'
                  // Cannot statically analyze function calls for entry points without execution
                  // This would require a more advanced concolic execution or sandbox approach
                  adapter.emitFinding({
                    severity: "info",
                    confidence: "low",
                    file: fileId,
                    location: undefined,
                    message: "Webpack entry point is a function, cannot statically determine entry files.",
                    evidence: { type: "function-entry" }
                  });
                }
              }

              // Handle 'output' property (e.g., publicPath, filename)
              if (propName === "output" && t.isObjectExpression(prop.value)) {
                prop.value.properties.forEach(outputProp => {
                  if (t.isObjectProperty(outputProp) && t.isIdentifier(outputProp.key)) {
                    const outputPropName = outputProp.key.name;
                    if (outputPropName === "path" && t.isStringLiteral(outputProp.value)) {
                      // Mark output path as used (directory)
                      adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, outputProp.value.value));
                    }
                    // Other output properties like 'filename' might refer to generated files,
                    // which are not directly source files. We'll focus on paths that refer to existing source.
                    if (outputPropName === "publicPath" && t.isStringLiteral(outputProp.value)) {
                      // Mark publicPath as used if it refers to a local path
                      // This is a heuristic, as publicPath can be a URL
                      if (outputProp.value.value.startsWith("/") || outputProp.value.value.startsWith("./")) {
                        adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, outputProp.value.value));
                      }
                    }
                  }
                });
              }

              // Handle 'resolve' property (e.g., alias, modules, extensions)
              if (propName === "resolve" && t.isObjectExpression(prop.value)) {
                prop.value.properties.forEach(resolveProp => {
                  if (t.isObjectProperty(resolveProp) && t.isIdentifier(resolveProp.key)) {
                    const resolvePropName = resolveProp.key.name;
                    if (resolvePropName === "alias" && t.isObjectExpression(resolveProp.value)) {
                      resolveProp.value.properties.forEach(aliasProp => {
                        if (t.isObjectProperty(aliasProp) && t.isStringLiteral(aliasProp.value)) {
                          // Mark alias values as used, as they refer to modules
                          adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, aliasProp.value.value));
                        }
                      });
                    } else if (resolvePropName === "modules" && t.isArrayExpression(resolveProp.value)) {
                      resolveProp.value.elements.forEach(modulePath => {
                        if (t.isStringLiteral(modulePath)) {
                          adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, modulePath.value));
                        }
                      });
                    }
                    // 'extensions' and 'mainFiles' are not directly marking files as used,
                    // but influence how modules are resolved.
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

export default WebpackPlugin;
