import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const RSBUILD_CONFIG_FILES = [
  "rsbuild.config.ts",
  "rsbuild.config.js",
  "rsbuild.config.mjs",
  "rsbuild.config.cjs",
  "rsbuild.config.mts",
  "rsbuild.config.cts",
];

const RSBUILD_PACKAGES = [
  "@rsbuild/core",
  "@rsbuild/plugin-react",
  "@rsbuild/plugin-vue",
  "@rsbuild/plugin-vue-jsx",
  "@rsbuild/plugin-svelte",
  "@rsbuild/plugin-solid",
  "@rsbuild/plugin-babel",
  "@rsbuild/plugin-swc",
  "@rsbuild/plugin-sass",
  "@rsbuild/plugin-less",
  "@rsbuild/plugin-stylus",
  "@rsbuild/plugin-type-check",
  "@rsbuild/plugin-eslint",
  "@rsbuild/plugin-node",
];

export const RsbuildPlugin: AnalyzerPlugin = {
  name: "rsbuild-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };
      if (
        Object.keys(allDeps).some((dep) => dep === "@rsbuild/core" || dep.startsWith("@rsbuild/"))
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && s.includes("rsbuild"))) {
          return true;
        }
      }
    }

    for (const configFile of RSBUILD_CONFIG_FILES) {
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

      const hasRsbuild = Object.keys(allDeps).some(
        (p) => p === "@rsbuild/core" || p.startsWith("@rsbuild/"),
      );

      // 1. Safeguard installed @rsbuild/* packages in package.json
      if (hasRsbuild) {
        for (const depName of Object.keys(allDeps)) {
          if (depName.startsWith("@rsbuild/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone config files
      let hasConfigFile = false;
      for (const configFile of RSBUILD_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Rsbuild CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("rsbuild") || scriptContent === "rsbuild")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@rsbuild/core");
          }
        }
      }

      // 4. Report missing dependency if config exists without @rsbuild/core
      if (hasConfigFile && !hasRsbuild) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Rsbuild configuration file found, but '@rsbuild/core' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Protect config files
      if (RSBUILD_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("@rsbuild/core");
      }

      // Rsbuild entries are configuration-defined. Do not promote files merely
      // because they happen to be named src/index.* or src/main.*; configured
      // `source.entry` values are handled in onASTNode below.
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = RSBUILD_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @rsbuild/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@rsbuild/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Rsbuild configuration files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@rsbuild/core");
        }

        // Detect defineConfig(...) call expression
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "defineConfig"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@rsbuild/core");
        }

        // Detect source.entry configuration option
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "entry") {
          const val = node.value;
          if (t.isStringLiteral(val)) {
            adapter.markAsUsed(val.value);
          } else if (t.isObjectExpression(val)) {
            val.properties.forEach((prop: any) => {
              if (prop.value && t.isStringLiteral(prop.value)) {
                adapter.markAsUsed(prop.value.value);
              } else if (prop.value && t.isArrayExpression(prop.value)) {
                prop.value.elements.forEach((el: any) => {
                  if (el && t.isStringLiteral(el)) {
                    adapter.markAsUsed(el.value);
                  }
                });
              }
            });
          }
        }

        // Detect plugins array in rsbuild config
        if (t.isObjectProperty(node) && t.isIdentifier(node.key) && node.key.name === "plugins") {
          if (t.isArrayExpression(node.value)) {
            node.value.elements.forEach((pluginCall: any) => {
              if (t.isCallExpression(pluginCall) && t.isIdentifier(pluginCall.callee)) {
                adapter.markAsUsed(fileId);
                adapter.markPackageAsUsed("@rsbuild/core");
              }
            });
          }
        }
      }
    },
  },
};

export default RsbuildPlugin;
