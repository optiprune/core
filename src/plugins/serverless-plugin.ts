import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

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
  try {
    const cleanJson = content
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
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
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("serverless ") ||
                s === "serverless" ||
                s.includes("sls ") ||
                s === "sls"),
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of SERVERLESS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
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
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking Serverless CLI (sls or serverless)
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("serverless") || scriptContent.includes("sls"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("serverless");
          }
        }
      }

      // 4. Inspect JSON/YAML serverless configs for plugins and handlers
      const jsonContent = await adapter.readFile("serverless.json");
      if (jsonContent) {
        const parsed = parseJsonc(jsonContent);
        if (parsed) {
          processServerlessConfigObj(parsed, adapter);
        }
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
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("serverless");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                // Protect plugins listed in config: plugins: ['serverless-esbuild', 'serverless-offline']
                if (prop.key.name === "plugins") {
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
                if (prop.key.name === "functions" && t.isObjectExpression(prop.value)) {
                  prop.value.properties.forEach((funcProp: any) => {
                    if (t.isObjectProperty(funcProp) && t.isObjectExpression(funcProp.value)) {
                      funcProp.value.properties.forEach((handlerProp: any) => {
                        if (
                          t.isObjectProperty(handlerProp) &&
                          t.isIdentifier(handlerProp.key) &&
                          handlerProp.key.name === "handler" &&
                          t.isStringLiteral(handlerProp.value)
                        ) {
                          const handlerPath = handlerProp.value.value.split(".")[0];
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
        const handlerFile = func.handler.split(".")[0];
        if (handlerFile) adapter.markAsUsed(handlerFile);
      }
    });
  }
}

export default ServerlessPlugin;
