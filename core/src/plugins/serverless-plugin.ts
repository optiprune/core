import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";
import {
  fileExists,
  hasCommand,
  parsePluginJson,
  parsePluginYaml,
  staticPropertyName,
} from "../plugin-utils.js";

const SERVERLESS_CONFIG_FILES = [
  "serverless.yml",
  "serverless.yaml",
  "serverless.json",
  "serverless.js",
  "serverless.cjs",
  "serverless.mjs",
  "serverless.ts",
  "serverless.cts",
  "serverless.mts",
  "serverless-compose.yml",
  "serverless-compose.yaml",
];

function parseJsonc<T = any>(content: string): T | null {
  return parsePluginJson<T>(content);
}

export const ServerlessPlugin: AnalyzerPlugin = {
  name: "serverless-plugin",
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
            dep === "serverless" || dep.startsWith("@serverless/") || dep.startsWith("serverless-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => hasCommand(s, ["serverless", "sls"]))) {
          return true;
        }
      }
    }

    for (const configFile of SERVERLESS_CONFIG_FILES) {
      if (await fileExists(adapter, configFile)) return true;
    }

    return await adapter.folderExists(".serverless");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasServerless = Object.keys(allDeps).some(
        (p) => p === "serverless" || p.startsWith("@serverless/") || p.startsWith("serverless-"),
      );

      // 1. Safeguard all installed Serverless ecosystem packages and plugins in package.json
      if (hasServerless) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "serverless" ||
            depName.startsWith("@serverless/") ||
            depName.startsWith("serverless-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of SERVERLESS_CONFIG_FILES) {
        if (await fileExists(adapter, configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Serverless CLI (sls or serverless)
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (hasCommand(scriptContent, ["serverless", "sls"])) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("serverless");
          }
        }
      }

      // 4. Inspect JSON/YAML serverless configs for plugins and handlers
      for (const configFile of SERVERLESS_CONFIG_FILES) {
        const content = await adapter.readFile(configFile);
        if (!content) continue;
        const parsed =
          configFile.endsWith(".yml") || configFile.endsWith(".yaml")
            ? parsePluginYaml(content)
            : parseJsonc(content);
        if (parsed) processServerlessConfigObj(parsed, adapter);
      }

      // 5. Emit finding if config file is present without serverless package
      if (hasConfigFile && !hasServerless) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Serverless Framework configuration found, but 'serverless' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Serverless configuration files
      if (SERVERLESS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("serverless");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SERVERLESS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for serverless or plugin packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "serverless" ||
          source.startsWith("@serverless/") ||
          source.startsWith("serverless-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Serverless JS/TS configuration files
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("serverless");
          configExpr = node.declaration;
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          (node.left?.property?.name === "exports" || node.left?.property?.value === "exports")
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("serverless");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && !!staticPropertyName(prop.key)) {
                // Protect plugins listed in config: plugins: ['serverless-esbuild', 'serverless-offline']
                if (staticPropertyName(prop.key) === "plugins") {
                  const val = prop.value;
                  if (t.isArrayExpression(val)) {
                    val.elements.forEach((el: any) => {
                      if (t.isStringLiteral(el)) {
                        adapter.markPackageAsUsed(el.value);
                      }
                    });
                  } else if (t.isStringLiteral(val)) {
                    adapter.markPackageAsUsed(val.value);
                  }
                }

                // Protect function handlers: functions: { hello: { handler: 'src/handler.hello' } }
                if (
                  staticPropertyName(prop.key) === "functions" &&
                  t.isObjectExpression(prop.value)
                ) {
                  prop.value.properties.forEach((funcProp: any) => {
                    if (t.isObjectProperty(funcProp) && t.isObjectExpression(funcProp.value)) {
                      funcProp.value.properties.forEach((handlerProp: any) => {
                        if (
                          t.isObjectProperty(handlerProp) &&
                          staticPropertyName(handlerProp.key) === "handler" &&
                          t.isStringLiteral(handlerProp.value)
                        ) {
                          const handlerPath = handlerProp.value.value.slice(
                            0,
                            handlerProp.value.value.lastIndexOf("."),
                          );
                          if (handlerPath) {
                            adapter.markAsUsed(handlerPath);
                          }
                        }
                      });
                    }
                  });
                }
              }
            });
          };

          if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          }
        }
      }
    },
  },
};

function processServerlessConfigObj(config: any, adapter: any): void {
  if (typeof config !== "object" || config === null) return;

  // Process "plugins" array
  if (Array.isArray(config.plugins)) {
    config.plugins.forEach((plugin: string) => {
      if (typeof plugin === "string") adapter.markPackageAsUsed(plugin);
    });
  }

  // Process "functions" definitions
  if (typeof config.functions === "object" && config.functions !== null) {
    Object.values(config.functions).forEach((func: any) => {
      if (typeof func?.handler === "string") {
        const handlerFile = func.handler.slice(0, func.handler.lastIndexOf("."));
        if (handlerFile) adapter.markAsUsed(handlerFile);
      }
    });
  }
}

export default ServerlessPlugin;
