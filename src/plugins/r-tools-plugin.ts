import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const R_CONFIG_FILES = [
  "rsbuild.config.ts",
  "rsbuild.config.js",
  "rsbuild.config.mjs",
  "rsbuild.config.cjs",
  "rsbuild.config.mts",
  "rsbuild.config.cts",
  "rslib.config.ts",
  "rslib.config.js",
  "rslib.config.mjs",
  "rslib.config.cjs",
  "rslib.config.mts",
  "rslib.config.cts",
  "rolldown.config.ts",
  "rolldown.config.js",
  "rolldown.config.mjs",
  "rolldown.config.cjs",
  "rolldown.config.mts",
  "rolldown.config.cts",
  "rolldown.config.json"
];

const R_TOOLS_PACKAGES = [
  "@rsbuild/core",
  "@rslib/core",
  "rolldown",
  "@rolldown/node"
];

export const RToolsPlugin: AnalyzerPlugin = {
  name: "r-tools-plugin",
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
            dep.startsWith("@rsbuild/") ||
            dep.startsWith("@rslib/") ||
            dep === "rolldown" ||
            dep.startsWith("@rolldown/")
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
              (s.includes("rsbuild") ||
                s.includes("rslib") ||
                s.includes("rolldown"))
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of R_CONFIG_FILES) {
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

      const hasRTools = Object.keys(allDeps).some(
        (p) =>
          p.startsWith("@rsbuild/") ||
          p.startsWith("@rslib/") ||
          p === "rolldown" ||
          p.startsWith("@rolldown/")
      );

      // 1. Safeguard installed R-Tools packages in package.json
      if (hasRTools) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName.startsWith("@rsbuild/") ||
            depName.startsWith("@rslib/") ||
            depName === "rolldown" ||
            depName.startsWith("@rolldown/")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect configuration files
      let hasConfigFile = false;
      for (const configFile of R_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking CLI tools
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string") {
            if (scriptContent.includes("rsbuild")) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
              adapter.markPackageAsUsed("@rsbuild/core");
            }
            if (scriptContent.includes("rslib")) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
              adapter.markPackageAsUsed("@rslib/core");
            }
            if (scriptContent.includes("rolldown")) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
              adapter.markPackageAsUsed("rolldown");
            }
          }
        }
      }

      // 4. Report missing dependency if configuration exists without tools
      if (hasConfigFile && !hasRTools) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Rsbuild, Rslib, or Rolldown configuration found, but core packages are missing from package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (R_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        if (basename.startsWith("rsbuild")) {
          adapter.markPackageAsUsed("@rsbuild/core");
        } else if (basename.startsWith("rslib")) {
          adapter.markPackageAsUsed("@rslib/core");
        } else if (basename.startsWith("rolldown")) {
          adapter.markPackageAsUsed("rolldown");
        }
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = R_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @rsbuild/*, @rslib/*, rolldown
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source.startsWith("@rsbuild/") ||
          source.startsWith("@rslib/") ||
          source === "rolldown" ||
          source.startsWith("@rolldown/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In configuration files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }

        // Detect defineConfig call expressions and extract entry points
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          ["defineConfig", "defineRsbuildConfig", "defineRslibConfig"].includes(
            node.callee.name
          )
        ) {
          adapter.markAsUsed(fileId);

          const firstArg = node.arguments[0];
          if (t.isObjectExpression(firstArg)) {
            firstArg.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                // Rolldown / Rslib 'input' or 'entry'
                if (
                  ["entry", "input"].includes(prop.key.name) &&
                  t.isStringLiteral(prop.value)
                ) {
                  adapter.markAsUsed(prop.value.value);
                }

                // Rsbuild 'source.entry'
                if (
                  prop.key.name === "source" &&
                  t.isObjectExpression(prop.value)
                ) {
                  prop.value.properties.forEach((sourceProp: any) => {
                    if (
                      t.isObjectProperty(sourceProp) &&
                      t.isIdentifier(sourceProp.key) &&
                      sourceProp.key.name === "entry"
                    ) {
                      if (t.isStringLiteral(sourceProp.value)) {
                        adapter.markAsUsed(sourceProp.value.value);
                      } else if (t.isObjectExpression(sourceProp.value)) {
                        sourceProp.value.properties.forEach((eProp: any) => {
                          if (
                            t.isObjectProperty(eProp) &&
                            t.isStringLiteral(eProp.value)
                          ) {
                            adapter.markAsUsed(eProp.value.value);
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
      }
    }
  }
};

export default RToolsPlugin;