import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TSDOWN_CONFIG_FILES = [
  "tsdown.config.ts",
  "tsdown.config.js",
  "tsdown.config.mjs",
  "tsdown.config.cjs",
  "tsdown.config.mts",
  "tsdown.config.cts",
  "tsdown.config.json"
];

const TSDOWN_PACKAGES = ["tsdown", "rolldown", "typescript"];

export const TsdownPlugin: AnalyzerPlugin = {
  name: "tsdown-plugin",
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
          (dep) => dep === "tsdown" || dep.startsWith("tsdown-")
        ) ||
        pkg.tsdown
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("tsdown ") || s === "tsdown")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of TSDOWN_CONFIG_FILES) {
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

      const hasTsdown = Object.keys(allDeps).some(
        (p) => p === "tsdown" || p.startsWith("tsdown-")
      );

      // 1. Safeguard tsdown ecosystem packages in package.json
      if (hasTsdown) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "tsdown" ||
            depName === "rolldown" ||
            depName.startsWith("tsdown-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of TSDOWN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "tsdown" block entry points
      if (pkg?.tsdown) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "tsdown");

        const tsdownConfig = pkg.tsdown;
        if (typeof tsdownConfig === "object" && tsdownConfig !== null) {
          const entry = tsdownConfig.entry;
          if (typeof entry === "string") {
            adapter.markAsUsed(entry);
          } else if (Array.isArray(entry)) {
            entry.forEach((e: string) => {
              if (typeof e === "string") adapter.markAsUsed(e);
            });
          } else if (typeof entry === "object") {
            Object.values(entry).forEach((e: any) => {
              if (typeof e === "string") adapter.markAsUsed(e);
            });
          }
        }
      }

      // 4. Track npm scripts invoking tsdown CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("tsdown ") || scriptContent === "tsdown")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("tsdown");
          }
        }
      }

      // 5. Report missing dependency if config exists without tsdown
      if (hasConfigFile && !hasTsdown) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "tsdown configuration found, but 'tsdown' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.tsdown }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (TSDOWN_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("tsdown");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = TSDOWN_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for tsdown packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "tsdown" || source.startsWith("tsdown-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In tsdown configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("tsdown");
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
          adapter.markPackageAsUsed("tsdown");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (
                t.isObjectProperty(prop) &&
                t.isIdentifier(prop.key) &&
                prop.key.name === "entry"
              ) {
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
                  val.properties.forEach((p: any) => {
                    if (
                      t.isObjectProperty(p) &&
                      t.isStringLiteral(p.value)
                    ) {
                      adapter.markAsUsed(p.value.value);
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
    }
  }
};

export default TsdownPlugin;