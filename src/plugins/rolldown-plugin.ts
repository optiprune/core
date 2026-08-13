import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ROLLDOWN_CONFIG_FILES = [
  "rolldown.config.js",
  "rolldown.config.mjs",
  "rolldown.config.cjs",
  "rolldown.config.ts",
  "rolldown.config.mts",
  "rolldown.config.cts",
  "rolldown.config.json"
];

const ROLLDOWN_CORE_PACKAGES = ["rolldown", "@rolldown/node"];

export const RolldownPlugin: AnalyzerPlugin = {
  name: "rolldown-plugin",
  version: "1.0.0",

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
            dep === "rolldown" ||
            dep.startsWith("@rolldown/") ||
            dep.startsWith("rolldown-plugin-")
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
              (s.includes("rolldown ") || s === "rolldown")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of ROLLDOWN_CONFIG_FILES) {
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

      const hasRolldown = Object.keys(allDeps).some(
        (p) =>
          p === "rolldown" ||
          p.startsWith("@rolldown/") ||
          p.startsWith("rolldown-plugin-")
      );

      // 1. Safeguard all installed Rolldown packages and plugins in package.json
      if (hasRolldown) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "rolldown" ||
            depName.startsWith("@rolldown/") ||
            depName.startsWith("rolldown-plugin-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of ROLLDOWN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Rolldown CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("rolldown ") || scriptContent === "rolldown")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("rolldown");
          }
        }
      }

      // 4. Report missing dependency if config exists without rolldown package
      if (hasConfigFile && !hasRolldown) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Rolldown configuration found, but 'rolldown' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (ROLLDOWN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("rolldown");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = ROLLDOWN_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for rolldown or @rolldown/* / rolldown-plugin-*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "rolldown" ||
          source.startsWith("@rolldown/") ||
          source.startsWith("rolldown-plugin-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Rolldown configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("rolldown");
          configExpr = node.declaration;
        }

        // Handle CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("rolldown");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                const keyName = prop.key.name;

                // Handle 'input' (entry points)
                if (keyName === "input") {
                  const val = prop.value;
                  if (t.isStringLiteral(val)) {
                    adapter.markAsUsed(val.value);
                  } else if (t.isArrayExpression(val)) {
                    val.elements.forEach((el: any) => {
                      if (t.isStringLiteral(el)) {
                        adapter.markAsUsed(el.value);
                      }
                    });
                  } else if (t.isObjectExpression(val)) {
                    val.properties.forEach((entryProp: any) => {
                      if (
                        t.isObjectProperty(entryProp) &&
                        t.isStringLiteral(entryProp.value)
                      ) {
                        adapter.markAsUsed(entryProp.value.value);
                      }
                    });
                  }
                }

                // Handle 'output' (dir, file, format)
                if (keyName === "output") {
                  const outVal = prop.value;
                  const processOutputObj = (o: any) => {
                    if (t.isObjectExpression(o)) {
                      o.properties.forEach((op: any) => {
                        if (
                          t.isObjectProperty(op) &&
                          t.isIdentifier(op.key) &&
                          ["dir", "file"].includes(op.key.name) &&
                          t.isStringLiteral(op.value)
                        ) {
                          adapter.markAsUsed(op.value.value);
                        }
                      });
                    }
                  };

                  if (t.isObjectExpression(outVal)) {
                    processOutputObj(outVal);
                  } else if (t.isArrayExpression(outVal)) {
                    outVal.elements.forEach((el: any) => processOutputObj(el));
                  }
                }

                // Handle 'plugins' array
                if (keyName === "plugins" && t.isArrayExpression(prop.value)) {
                  prop.value.elements.forEach((pluginExpr: any) => {
                    if (
                      t.isCallExpression(pluginExpr) &&
                      t.isIdentifier(pluginExpr.callee)
                    ) {
                      adapter.markAsUsed(fileId);
                      adapter.markPackageAsUsed("rolldown");
                    }
                  });
                }
              }
            });
          };

          // Unwrap defineConfig(...) call expressions
          if (t.isCallExpression(configExpr)) {
            const firstArg = configExpr.arguments[0];

            if (t.isObjectExpression(firstArg)) {
              processObject(firstArg);
            } else if (t.isArrayExpression(firstArg)) {
              firstArg.elements.forEach((el: any) => processObject(el));
            } else if (
              t.isArrowFunctionExpression(firstArg) ||
              t.isFunctionExpression(firstArg)
            ) {
              const body = (firstArg as any).body;
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
            }
          } else if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          } else if (t.isArrayExpression(configExpr)) {
            configExpr.elements.forEach((el: any) => processObject(el));
          }
        }
      }

      // 3. Detect Rolldown plugin hook declarations (name, resolveId, load, transform, buildStart, renderChunk)
      if (t.isObjectExpression(node)) {
        const hasPluginKeys = node.properties.some(
          (p: any) =>
            t.isObjectProperty(p) &&
            t.isIdentifier(p.key) &&
            [
              "name",
              "resolveId",
              "load",
              "transform",
              "buildStart",
              "generateBundle",
              "renderChunk"
            ].includes(p.key.name)
        );

        if (
          hasPluginKeys &&
          (normalized.includes("plugin") || normalized.includes("rolldown"))
        ) {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default RolldownPlugin;