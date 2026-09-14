import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const ROLLUP_CONFIG_FILES = [
  "rollup.config.js",
  "rollup.config.mjs",
  "rollup.config.cjs",
  "rollup.config.ts",
  "rollup.config.mts",
  "rollup.config.cts",
];

const ROLLUP_CORE_PACKAGES = [
  "rollup",
  "@rollup/plugin-node-resolve",
  "@rollup/plugin-commonjs",
  "@rollup/plugin-typescript",
  "@rollup/plugin-babel",
  "@rollup/plugin-json",
  "@rollup/plugin-terser",
  "@rollup/plugin-replace",
  "@rollup/plugin-alias",
  "@rollup/plugin-url",
];

export const RollupPlugin: AnalyzerPlugin = {
  name: "rollup-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "rollup" || dep.startsWith("@rollup/") || dep.startsWith("rollup-plugin-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("rollup ") || s === "rollup"),
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of ROLLUP_CONFIG_FILES) {
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

      const hasRollup = Object.keys(allDeps).some(
        (p) => p === "rollup" || p.startsWith("@rollup/") || p.startsWith("rollup-plugin-"),
      );

      // 1. Safeguard all installed Rollup packages and plugins in package.json
      if (hasRollup) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "rollup" ||
            depName.startsWith("@rollup/") ||
            depName.startsWith("rollup-plugin-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of ROLLUP_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Rollup CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("rollup ") || scriptContent === "rollup")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("rollup");
          }
        }
      }

      // 4. Report missing dependency if config file exists without rollup package
      if (hasConfigFile && !hasRollup) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Rollup configuration found, but 'rollup' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (ROLLUP_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("rollup");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = ROLLUP_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for rollup or @rollup/* / rollup-plugin-* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "rollup" ||
          source.startsWith("@rollup/") ||
          source.startsWith("rollup-plugin-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Rollup configuration files
      if (isConfigFile) {
        let configNode: any = null;

        // ESM export default { input: ..., output: ... }
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("rollup");

          const decl = node.declaration;
          if (t.isObjectExpression(decl) || t.isArrayExpression(decl)) {
            configNode = decl;
          }
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("rollup");

          if (t.isObjectExpression(node.right) || t.isArrayExpression(node.right)) {
            configNode = node.right;
          }
        }

        if (configNode) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            for (const prop of objExpr.properties) {
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
                      if (t.isObjectProperty(entryProp) && t.isStringLiteral(entryProp.value)) {
                        adapter.markAsUsed(entryProp.value.value);
                      }
                    });
                  }
                }

                // Handle 'output' (directories & targets)
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

                // Handle 'plugins'
                if (keyName === "plugins" && t.isArrayExpression(prop.value)) {
                  prop.value.elements.forEach((pluginExpr: any) => {
                    if (t.isCallExpression(pluginExpr) && t.isIdentifier(pluginExpr.callee)) {
                      adapter.markAsUsed(fileId);
                      adapter.markPackageAsUsed("rollup");
                    }
                  });
                }
              }
            }
          };

          if (t.isArrayExpression(configNode)) {
            configNode.elements.forEach((el: any) => processObject(el));
          } else {
            processObject(configNode);
          }
        }
      }

      // 3. Detect Rollup plugin hooks inside plugin files (e.g. name, resolveId, load, transform, buildStart)
      if (t.isObjectExpression(node)) {
        const hasPluginKeys = node.properties.some(
          (p: any) =>
            t.isObjectProperty(p) &&
            t.isIdentifier(p.key) &&
            ["name", "resolveId", "load", "transform", "buildStart", "generateBundle"].includes(
              p.key.name,
            ),
        );

        if (hasPluginKeys && (normalized.includes("plugin") || normalized.includes("rollup"))) {
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default RollupPlugin;
