import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const QUASAR_CONFIG_FILES = [
  "quasar.config.js",
  "quasar.config.cjs",
  "quasar.config.mjs",
  "quasar.config.ts",
  "quasar.config.cts",
  "quasar.config.mts",
  "quasar.conf.js"
];

const QUASAR_CORE_PACKAGES = [
  "quasar",
  "@quasar/app-vite",
  "@quasar/app-webpack",
  "@quasar/extras",
  "@quasar/icongenie"
];

export const QuasarPlugin: AnalyzerPlugin = {
  name: "quasar-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies and scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (
        Object.keys(allDeps).some(
          (dep) => dep === "quasar" || dep.startsWith("@quasar/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" && (s.includes("quasar ") || s === "quasar")
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for Quasar configuration files
    for (const configFile of QUASAR_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 3. Check for Quasar project directories
    return (
      (await adapter.folderExists("src/boot")) ||
      (await adapter.folderExists("src/layouts"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasQuasar = Object.keys(allDeps).some(
        (p) => p === "quasar" || p.startsWith("@quasar/")
      );

      // 1. Safeguard all installed Quasar ecosystem packages in package.json
      if (hasQuasar) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "quasar" || depName.startsWith("@quasar/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of QUASAR_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Protect Quasar boot files, layouts, and pages directories
      for (const dir of ["src/boot", "src/layouts", "src/pages"]) {
        if (await adapter.folderExists(dir)) {
          adapter.markAsUsed(dir);
        }
      }

      // 4. Track npm scripts invoking Quasar CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("quasar ") || scriptContent === "quasar")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("quasar");
          }
        }
      }

      // 5. Report missing dependency if config exists without quasar package
      if (hasConfigFile && !hasQuasar) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Quasar configuration found, but 'quasar' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Quasar configuration files
      if (QUASAR_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("quasar");
      }

      // Protect Quasar boot files (src/boot/*)
      if (
        normalized.includes("/src/boot/") ||
        normalized.startsWith("src/boot/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("quasar");
      }

      // Protect Quasar layout and page components
      if (
        normalized.includes("/src/layouts/") ||
        normalized.includes("/src/pages/") ||
        normalized.startsWith("src/layouts/") ||
        normalized.startsWith("src/pages/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("quasar");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = QUASAR_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for quasar or @quasar/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "quasar" || source.startsWith("@quasar/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect Quasar boot file defineBoot() helper or useQuasar() composable
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (
          ["defineBoot", "useQuasar", "useMeta", "createQuasar"].includes(
            node.callee.name
          )
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("quasar");
        }
      }

      // 3. Inspect Quasar configuration files (quasar.config.js / quasar.config.ts)
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("quasar");
          configExpr = node.declaration;
        }

        // CommonJS module.exports = ...
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("quasar");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                // Extract declared boot files: boot: ['i18n', 'axios']
                if (
                  prop.key.name === "boot" &&
                  t.isArrayExpression(prop.value)
                ) {
                  prop.value.elements.forEach((el: any) => {
                    if (t.isStringLiteral(el)) {
                      adapter.markAsUsed(`src/boot/${el.value}`);
                    }
                  });
                }

                // Extract Quasar plugins: framework: { plugins: ['Notify', 'Dialog'] }
                if (
                  prop.key.name === "framework" &&
                  t.isObjectExpression(prop.value)
                ) {
                  prop.value.properties.forEach((fProp: any) => {
                    if (
                      t.isObjectProperty(fProp) &&
                      t.isIdentifier(fProp.key) &&
                      fProp.key.name === "plugins" &&
                      t.isArrayExpression(fProp.value)
                    ) {
                      adapter.markPackageAsUsed("quasar");
                    }
                  });
                }
              }
            });
          };

          // Unwrap configure(...) wrapper callback function
          if (t.isCallExpression(configExpr)) {
            const firstArg = configExpr.arguments[0];

            if (
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
            } else if (t.isObjectExpression(firstArg)) {
              processObject(firstArg);
            }
          } else if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          }
        }
      }
    }
  }
};

export default QuasarPlugin;