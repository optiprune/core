import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const VITE_CONFIG_FILES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.cjs",
  "vite.config.mts",
  "vite.config.cts",
];

export const VitePlugin: AnalyzerPlugin = {
  name: "vite-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["vite"] || pkg.dependencies?.["vite"])) {
      return true;
    }
    for (const file of VITE_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasVite = pkg ? !!(pkg.dependencies?.["vite"] || pkg.devDependencies?.["vite"]) : false;
      
      let hasConfigFile = false;
      for (const file of VITE_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasVite) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Vite configuration found but 'vite' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: async (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (VITE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      const basename = path.basename(fileId);
      if (VITE_CONFIG_FILES.includes(basename)) {
        // Handle defineConfig({ ... }) or export default { ... }
        let configObjectNode = null;
        if (t.isExportDefaultDeclaration(node)) {
          if (t.isObjectExpression(node.declaration)) {
            configObjectNode = node.declaration;
          } else if (t.isCallExpression(node.declaration) && node.declaration.arguments.length > 0 && t.isObjectExpression(node.declaration.arguments[0])) {
            configObjectNode = node.declaration.arguments[0];
          }
        }

        if (configObjectNode) {
          for (const prop of configObjectNode.properties) {
            if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
              const propName = prop.key.name;

              // build.lib.entry or build.rollupOptions.input
              if (propName === "build" && t.isObjectExpression(prop.value)) {
                prop.value.properties.forEach(buildProp => {
                  if (t.isObjectProperty(buildProp) && t.isIdentifier(buildProp.key)) {
                    if (buildProp.key.name === "lib" && t.isObjectExpression(buildProp.value)) {
                      buildProp.value.properties.forEach(libProp => {
                        if (t.isObjectProperty(libProp) && t.isIdentifier(libProp.key) && libProp.key.name === "entry") {
                          if (t.isStringLiteral(libProp.value)) {
                            adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, libProp.value.value));
                          }
                        }
                      });
                    }
                    if (buildProp.key.name === "rollupOptions" && t.isObjectExpression(buildProp.value)) {
                      buildProp.value.properties.forEach(rollupProp => {
                        if (t.isObjectProperty(rollupProp) && t.isIdentifier(rollupProp.key) && rollupProp.key.name === "input") {
                          if (t.isStringLiteral(rollupProp.value)) {
                            adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, rollupProp.value.value));
                          } else if (t.isArrayExpression(rollupProp.value)) {
                            rollupProp.value.elements.forEach(el => {
                              if (t.isStringLiteral(el)) adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, el.value));
                            });
                          }
                        }
                      });
                    }
                  }
                });
              }

              // resolve.alias
              if (propName === "resolve" && t.isObjectExpression(prop.value)) {
                prop.value.properties.forEach(resolveProp => {
                  if (t.isObjectProperty(resolveProp) && t.isIdentifier(resolveProp.key) && resolveProp.key.name === "alias" && t.isObjectExpression(resolveProp.value)) {
                    resolveProp.value.properties.forEach(aliasProp => {
                      if (t.isObjectProperty(aliasProp) && t.isStringLiteral(aliasProp.value)) {
                        adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, aliasProp.value.value));
                      }
                    });
                  }
                });
              }

              // plugins
              if (propName === "plugins" && t.isArrayExpression(prop.value)) {
                prop.value.elements.forEach(plugin => {
                  if (t.isCallExpression(plugin) && t.isIdentifier(plugin.callee)) {
                    const pluginName = plugin.callee.name;
                    // Mark common vite plugins as used
                    if (['pages', 'pwa', 'layouts'].some(p => pluginName.toLowerCase().includes(p))) {
                      adapter.markAsUsed(fileId);
                    }
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

export default VitePlugin;
