import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const RSPACK_CONFIG_FILES = [
  "rspack.config.js",
  "rspack.config.mjs",
  "rspack.config.cjs",
  "rspack.config.ts",
  "rspack.config.mts",
  "rspack.config.cts"
];

const RSPACK_PACKAGES = [
  "@rspack/core",
  "@rspack/cli",
  "@rspack/dev-server",
  "@rspack/plugin-react-refresh",
  "rspack"
];

export const RspackPlugin: AnalyzerPlugin = {
  name: "rspack-plugin",
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
          (dep) => dep === "rspack" || dep.startsWith("@rspack/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("rspack ") || s === "rspack")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of RSPACK_CONFIG_FILES) {
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

      const hasRspack = Object.keys(allDeps).some(
        (p) => p === "rspack" || p.startsWith("@rspack/")
      );

      // 1. Safeguard installed Rspack ecosystem packages in package.json
      if (hasRspack) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "rspack" || depName.startsWith("@rspack/")) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of RSPACK_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Rspack CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("rspack ") || scriptContent === "rspack")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@rspack/cli");
          }
        }
      }

      // 4. Report missing dependency if configuration exists without Rspack package
      if (hasConfigFile && !hasRspack) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Rspack configuration found, but '@rspack/core' or 'rspack' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Rspack configuration files
      if (RSPACK_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@rspack/core");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = RSPACK_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @rspack/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "rspack" || source.startsWith("@rspack/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Rspack configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@rspack/core");
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
          adapter.markPackageAsUsed("@rspack/core");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            for (const prop of objExpr.properties) {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                const keyName = prop.key.name;

                // Handle 'entry' (entry points)
                if (keyName === "entry") {
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

                // Handle 'output' (path, filename)
                if (keyName === "output" && t.isObjectExpression(prop.value)) {
                  prop.value.properties.forEach((op: any) => {
                    if (
                      t.isObjectProperty(op) &&
                      t.isIdentifier(op.key) &&
                      ["path", "filename"].includes(op.key.name) &&
                      t.isStringLiteral(op.value)
                    ) {
                      adapter.markAsUsed(op.value.value);
                    }
                  });
                }
              }
            }
          };

          // Unwrap defineConfig(...) call expressions or function callbacks
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
          } else if (
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
          }
        }
      }
    }
  }
};

export default RspackPlugin;