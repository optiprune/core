import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const KNEX_CONFIG_FILES = [
  "knexfile.js",
  "knexfile.cjs",
  "knexfile.mjs",
  "knexfile.ts",
  "knexfile.cts",
  "knexfile.mts"
];

const KNEX_DRIVERS = [
  "pg",
  "pg-native",
  "mysql",
  "mysql2",
  "sqlite3",
  "better-sqlite3",
  "oracledb",
  "tedious",
  "mariasql"
];

export const KnexPlugin: AnalyzerPlugin = {
  name: "knex-plugin",
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
          (dep) => dep === "knex" || dep.startsWith("@knex/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("knex ") || s === "knex")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of KNEX_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("migrations")) ||
      (await adapter.folderExists("seeds"))
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

      const hasKnex = Object.keys(allDeps).some(
        (p) => p === "knex" || p.startsWith("@knex/")
      );

      // 1. Safeguard installed Knex core and driver dependencies in package.json
      if (hasKnex) {
        adapter.markPackageAsUsed("knex");

        // Package declaration alone is not usage evidence.
      }

      // 2. Protect standalone configuration files and default migration/seed directories
      let hasConfigFile = false;
      for (const configFile of KNEX_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists("migrations")) {
        adapter.markAsUsed("migrations");
      }

      if (await adapter.folderExists("seeds")) {
        adapter.markAsUsed("seeds");
      }

      // 3. Track npm scripts invoking Knex CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("knex ") || scriptContent === "knex")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("knex");
          }
        }
      }

      // 4. Report missing dependency if knexfile exists without knex package
      if (hasConfigFile && !hasKnex) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Knex configuration found, but 'knex' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Knex configuration files
      if (KNEX_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("knex");
      }

      // Protect files inside migrations or seeds directories
      if (
        normalized.includes("/migrations/") ||
        normalized.includes("/seeds/") ||
        normalized.startsWith("migrations/") ||
        normalized.startsWith("seeds/")
      ) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("knex");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = KNEX_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for knex or knex plugins
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "knex" || source.startsWith("@knex/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('knex')
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "knex" || arg.value.startsWith("@knex/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Inspect Knex configuration files (knexfile.js/ts) for client driver and custom paths
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("knex");
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
          adapter.markPackageAsUsed("knex");
          configExpr = node.right;
        }

        if (configExpr) {
          const processConfigObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop)) {
                const envObj = prop.value;

                if (t.isObjectExpression(envObj)) {
                  envObj.properties.forEach((envProp: any) => {
                    if (t.isObjectProperty(envProp) && t.isIdentifier(envProp.key)) {
                      // Detect database client driver (e.g. client: 'pg' or client: 'better-sqlite3')
                      if (
                        envProp.key.name === "client" &&
                        t.isStringLiteral(envProp.value)
                      ) {
                        adapter.markPackageAsUsed(envProp.value.value);
                      }

                      // Detect custom migrations or seeds directories
                      if (
                        ["migrations", "seeds"].includes(envProp.key.name) &&
                        t.isObjectExpression(envProp.value)
                      ) {
                        envProp.value.properties.forEach((dirProp: any) => {
                          if (
                            t.isObjectProperty(dirProp) &&
                            t.isIdentifier(dirProp.key) &&
                            dirProp.key.name === "directory"
                          ) {
                            if (t.isStringLiteral(dirProp.value)) {
                              adapter.markAsUsed(dirProp.value.value);
                            } else if (t.isArrayExpression(dirProp.value)) {
                              dirProp.value.elements.forEach((el: any) => {
                                if (t.isStringLiteral(el)) {
                                  adapter.markAsUsed(el.value);
                                }
                              });
                            }
                          }
                        });
                      }
                    }
                  });
                }
              }
            });
          };

          if (t.isObjectExpression(configExpr)) {
            processConfigObject(configExpr);
          }
        }
      }
    }
  }
};

export default KnexPlugin;