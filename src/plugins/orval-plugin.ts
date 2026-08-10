import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ORVAL_CONFIG_FILES = [
  "orval.config.ts",
  "orval.config.js",
  "orval.config.mjs",
  "orval.config.cjs",
  "orval.config.mts",
  "orval.config.cts",
  "orval.config.json"
];

const ORVAL_PACKAGES = ["orval", "@orval/core", "@orval/query", "@orval/axios"];

export const OrvalPlugin: AnalyzerPlugin = {
  name: "orval-plugin",
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
          (dep) => dep === "orval" || dep.startsWith("@orval/")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("orval") || s === "orval")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of ORVAL_CONFIG_FILES) {
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

      const hasOrval = Object.keys(allDeps).some(
        (p) => p === "orval" || p.startsWith("@orval/")
      );

      // 1. Safeguard installed Orval packages in package.json
      if (hasOrval) {
        for (const depName of ORVAL_PACKAGES) {
          if (allDeps[depName]) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of ORVAL_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Orval CLI (e.g., "generate:api": "orval")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("orval") || scriptContent === "orval")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("orval");
          }
        }
      }

      // 4. Report missing dependency if configuration file exists without orval
      if (hasConfigFile && !hasOrval) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Orval configuration found, but 'orval' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (ORVAL_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("orval");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = ORVAL_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for orval or @orval/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "orval" || source.startsWith("@orval/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Orval configuration files (orval.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("orval");
        }

        // CommonJS module.exports = { ... } or defineConfig(...)
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("orval");
        }

        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("orval");
        }

        // Extract target output file / directory (output.target) and custom mutators (output.override.mutator)
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "output"
        ) {
          if (t.isObjectExpression(node.value)) {
            node.value.properties.forEach((prop: any) => {
              if (!t.isIdentifier(prop.key)) return;

              // Extract target generated file path: target: 'src/api/endpoints.ts'
              if (prop.key.name === "target" && t.isStringLiteral(prop.value)) {
                adapter.markAsUsed(prop.value.value);
              }

              // Extract custom mutator file path: mutator: { path: './src/api/mutator/custom-instance.ts', name: 'customInstance' }
              if (
                prop.key.name === "override" &&
                t.isObjectExpression(prop.value)
              ) {
                prop.value.properties.forEach((overrideProp: any) => {
                  if (
                    overrideProp.key?.name === "mutator" &&
                    t.isObjectExpression(overrideProp.value)
                  ) {
                    overrideProp.value.properties.forEach((mutatorProp: any) => {
                      if (
                        mutatorProp.key?.name === "path" &&
                        t.isStringLiteral(mutatorProp.value)
                      ) {
                        adapter.markAsUsed(mutatorProp.value.value);
                      }
                    });
                  }
                });
              }
            });
          }
        }
      }
    }
  }
};

export default OrvalPlugin;