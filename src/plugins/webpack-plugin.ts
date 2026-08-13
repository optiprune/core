import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const WEBPACK_CONFIG_FILES = [
  "webpack.config.js",
  "webpack.config.mjs",
  "webpack.config.cjs",
  "webpack.config.ts",
  "webpack.config.mts",
  "webpack.config.cts"
];

const WEBPACK_PACKAGES = [
  "webpack",
  "webpack-cli",
  "webpack-dev-server",
  "html-webpack-plugin",
  "mini-css-extract-plugin",
  "webpack-merge",
  "copy-webpack-plugin"
];

export const WebpackPlugin: AnalyzerPlugin = {
  name: "webpack-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "webpack" ||
            dep === "@nx/webpack" ||
            dep.startsWith("webpack-") ||
            dep.endsWith("-loader")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("webpack ") || s === "webpack")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of WEBPACK_CONFIG_FILES) {
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

      const hasWebpack = Object.keys(allDeps).some(
        (p) =>
          p === "webpack" || p === "@nx/webpack" || p.startsWith("webpack-") || p.endsWith("-loader")
      );

      // 1. Safeguard installed Webpack ecosystem packages and loaders in package.json
      if (hasWebpack) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "webpack" ||
            depName.startsWith("webpack-") ||
            depName.endsWith("-loader")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of WEBPACK_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Webpack CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("webpack ") || scriptContent === "webpack")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("webpack-cli");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without Webpack package
      if (hasConfigFile && !hasWebpack) {
        if (await adapter.folderExists("nx.json")) {
          adapter.markPackageAsUsed("@nx/webpack");
        } else {
          adapter.markPackageAsUsed("webpack");
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Ignore common lockfiles and JSON files
      if (
        [
          "package.json",
          "package-lock.json",
          "yarn.lock",
          "pnpm-lock.yaml"
        ].includes(basename) ||
        basename.endsWith(".json")
      ) {
        return;
      }

      // Webpack Config itself is an entry point
      if (WEBPACK_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("webpack");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = WEBPACK_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for Webpack plugins or loaders
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "webpack" ||
          source.startsWith("webpack-") ||
          source.endsWith("-loader")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Inspect Webpack configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("webpack");
          configExpr = node.declaration;
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("webpack");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (configObjectNode: any) => {
            if (!t.isObjectExpression(configObjectNode)) return;

            for (const prop of configObjectNode.properties) {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                const propName = prop.key.name;

                // Handle 'entry' property
                if (propName === "entry") {
                  const value = prop.value;
                  if (t.isStringLiteral(value)) {
                    adapter.markAsUsed(value.value);
                  } else if (t.isArrayExpression(value)) {
                    value.elements.forEach((element: any) => {
                      if (t.isStringLiteral(element)) {
                        adapter.markAsUsed(element.value);
                      }
                    });
                  } else if (t.isObjectExpression(value)) {
                    value.properties.forEach((entryProp: any) => {
                      if (
                        t.isObjectProperty(entryProp) &&
                        t.isStringLiteral(entryProp.value)
                      ) {
                        adapter.markAsUsed(entryProp.value.value);
                      } else if (
                        t.isObjectProperty(entryProp) &&
                        t.isArrayExpression(entryProp.value)
                      ) {
                        entryProp.value.elements.forEach((element: any) => {
                          if (t.isStringLiteral(element)) {
                            adapter.markAsUsed(element.value);
                          }
                        });
                      }
                    });
                  } else if (t.isCallExpression(value)) {
                    adapter.emitFinding({
                      rule: "dynamic-entry",
                      severity: "info",
                      confidence: "low",
                      file: fileId,
                      message:
                        "Webpack entry point is dynamic, cannot statically determine all entry files.",
                      evidence: { type: "function-entry" }
                    });
                  }
                }

                // Handle 'output' property
                if (
                  propName === "output" &&
                  t.isObjectExpression(prop.value)
                ) {
                  prop.value.properties.forEach((outputProp: any) => {
                    if (
                      t.isObjectProperty(outputProp) &&
                      t.isIdentifier(outputProp.key)
                    ) {
                      const outputPropName = outputProp.key.name;
                      if (
                        outputPropName === "path" &&
                        t.isStringLiteral(outputProp.value)
                      ) {
                        adapter.markAsUsed(outputProp.value.value);
                      }

                      if (
                        outputPropName === "publicPath" &&
                        t.isStringLiteral(outputProp.value)
                      ) {
                        if (
                          outputProp.value.value.startsWith("/") ||
                          outputProp.value.value.startsWith("./")
                        ) {
                          adapter.markAsUsed(outputProp.value.value);
                        }
                      }
                    }
                  });
                }

                // Handle 'resolve' property (alias, modules)
                if (
                  propName === "resolve" &&
                  t.isObjectExpression(prop.value)
                ) {
                  prop.value.properties.forEach((resolveProp: any) => {
                    if (
                      t.isObjectProperty(resolveProp) &&
                      t.isIdentifier(resolveProp.key)
                    ) {
                      const resolvePropName = resolveProp.key.name;

                      if (
                        resolvePropName === "alias" &&
                        t.isObjectExpression(resolveProp.value)
                      ) {
                        resolveProp.value.properties.forEach((aliasProp: any) => {
                          if (
                            t.isObjectProperty(aliasProp) &&
                            t.isStringLiteral(aliasProp.value)
                          ) {
                            adapter.markAsUsed(aliasProp.value.value);
                          }
                        });
                      } else if (
                        resolvePropName === "modules" &&
                        t.isArrayExpression(resolveProp.value)
                      ) {
                        resolveProp.value.elements.forEach((modulePath: any) => {
                          if (t.isStringLiteral(modulePath)) {
                            adapter.markAsUsed(modulePath.value);
                          }
                        });
                      }
                    }
                  });
                }
              }
            }
          };

          // Unwrap function definitions: module.exports = (env, argv) => ({ ... })
          if (
            t.isArrowFunctionExpression(configExpr) ||
            t.isFunctionExpression(configExpr)
          ) {
            const body = (configExpr as any).body;
            if (t.isObjectExpression(body)) {
              processObject(body);
            } else if (t.isBlockStatement(body)) {
              body.body.forEach((stmt: any) => {
                if (
                  t.isReturnStatement(stmt) &&
                  t.isObjectExpression(stmt.argument)
                ) {
                  processObject(stmt.argument);
                }
              });
            }
          } else if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          } else if (t.isArrayExpression(configExpr)) {
            configExpr.elements.forEach((el: any) => processObject(el));
          }
        }
      }
    }
  }
};

export default WebpackPlugin;