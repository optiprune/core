import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const RSLIB_CONFIG_FILES = [
  "rslib.config.ts",
  "rslib.config.js",
  "rslib.config.mjs",
  "rslib.config.cjs",
  "rslib.config.mts",
  "rslib.config.cts",
];

const RSLIB_PACKAGES = ["@rslib/core", "@rsbuild/core"];

export const RslibPlugin: AnalyzerPlugin = {
  name: "rslib-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      if (RSLIB_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && s.includes("rslib"))) {
          return true;
        }
      }
    }

    for (const configFile of RSLIB_CONFIG_FILES) {
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
        ...pkg?.peerDependencies,
      };

      const hasRslibDep = RSLIB_PACKAGES.some((p) => p in allDeps);

      // 1. Safeguard installed @rslib/* packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // 2. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of RSLIB_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Rslib CLI (e.g., "build": "rslib build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("rslib") || scriptContent === "rslib")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@rslib/core");
          }
        }
      }

      // 4. Report missing dependency if config exists without @rslib/core
      if (hasConfigFile && !hasRslibDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Rslib configuration file found, but '@rslib/core' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Rslib config files
      if (RSLIB_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("@rslib/core");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = RSLIB_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @rslib/core
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "@rslib/core" || source.startsWith("@rslib/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Rslib configuration files (rslib.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@rslib/core");
        }

        // Detect defineConfig(...) call expression
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@rslib/core");
        }

        // Extract lib.entry configurations: lib: [{ format: 'esm', syntax: 'es2021', entry: { index: './src/index.ts' } }]
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "lib") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((libTarget: any) => {
              if (t.isObjectExpression(libTarget)) {
                libTarget.properties.forEach((prop: any) => {
                  if (
                    t.isObjectProperty(prop) &&
                    t.isIdentifier(prop.key) &&
                    prop.key.name === "entry"
                  ) {
                    if (t.isStringLiteral(prop.value)) {
                      adapter.markAsUsed(prop.value.value);
                    } else if (t.isObjectExpression(prop.value)) {
                      prop.value.properties.forEach((entryProp: any) => {
                        if (entryProp.value && t.isStringLiteral(entryProp.value)) {
                          adapter.markAsUsed(entryProp.value.value);
                        }
                      });
                    }
                  }
                });
              }
            });
          }
        }
      }
    },
  },
};

export default RslibPlugin;
