import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const TSUP_CONFIG_FILES = [
  "tsup.config.ts",
  "tsup.config.js",
  "tsup.config.mjs",
  "tsup.config.cjs",
  "tsup.config.mts",
  "tsup.config.cts",
  "tsup.config.json"
];

const TSUP_PACKAGES = ["tsup", "esbuild", "typescript"];

export const TsupPlugin: AnalyzerPlugin = {
  name: "tsup-plugin",
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
            dep === "tsup" ||
            dep.startsWith("tsup-plugin-")
        ) ||
        pkg.tsup
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("tsup ") || s === "tsup")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of TSUP_CONFIG_FILES) {
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

      const hasTsup = Object.keys(allDeps).some(
        (p) => p === "tsup" || p.startsWith("tsup-plugin-")
      );

      // 1. Safeguard tsup ecosystem packages in package.json
      if (hasTsup) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "tsup" ||
            depName === "esbuild" ||
            depName.startsWith("tsup-plugin-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of TSUP_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "tsup" block entry points
      if (pkg?.tsup) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "tsup");

        const tsupConfig = pkg.tsup;
        if (typeof tsupConfig === "object") {
          const entry = tsupConfig.entry;
          if (typeof entry === "string") {
            adapter.markAsUsed(entry);
          } else if (Array.isArray(entry)) {
            entry.forEach((e: string) => {
              if (typeof e === "string") adapter.markAsUsed(e);
            });
          } else if (typeof entry === "object" && entry !== null) {
            Object.values(entry).forEach((e: any) => {
              if (typeof e === "string") adapter.markAsUsed(e);
            });
          }
        }
      }

      // 4. Track npm scripts invoking tsup CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("tsup ") || scriptContent === "tsup")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("tsup");
          }
        }
      }

      // 5. Report missing dependency if config exists without tsup
      if (hasConfigFile && !hasTsup) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "tsup configuration found, but 'tsup' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.tsup }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (TSUP_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("tsup");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = TSUP_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for tsup packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "tsup" || source.startsWith("tsup-plugin-")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In tsup configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("tsup");
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
          adapter.markPackageAsUsed("tsup");
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

            // defineConfig({ entry: ... })
            if (t.isObjectExpression(firstArg)) {
              processObject(firstArg);
            }
            // defineConfig([ { entry: ... }, { entry: ... } ])
            else if (t.isArrayExpression(firstArg)) {
              firstArg.elements.forEach((el: any) => processObject(el));
            }
            // defineConfig((overrideOptions) => ({ entry: ... }))
            else if (
              t.isArrowFunctionExpression(firstArg) ||
              t.isFunctionExpression(firstArg)
            ) {
              const body = firstArg.body;
              if (t.isObjectExpression(body)) {
                processObject(body);
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

export default TsupPlugin;