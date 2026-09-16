import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const UNBUILD_CONFIG_FILES = [
  "build.config.ts",
  "build.config.js",
  "build.config.mjs",
  "build.config.cjs",
  "build.config.mts",
  "build.config.cts",
  "build.config.json",
];

const UNBUILD_PACKAGES = ["unbuild", "mkdist", "untun"];

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

export const UnbuildPlugin: AnalyzerPlugin = {
  name: "unbuild-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, unbuild block, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some((dep) => dep === "unbuild" || dep === "mkdist") ||
        pkg.unbuild
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("unbuild") || s.includes("unbuild ")),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files
    for (const configFile of UNBUILD_CONFIG_FILES) {
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

      const hasUnbuild = Object.keys(allDeps).some((p) => p === "unbuild" || p === "mkdist");

      // 1. Safeguard installed unbuild packages in package.json
      if (hasUnbuild) {
        for (const depName of Object.keys(allDeps)) {
          if (depName === "unbuild" || depName === "mkdist") {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of UNBUILD_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "unbuild" block if present
      let unbuildConfig: any = null;
      if (pkg?.unbuild) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "unbuild");
        unbuildConfig = pkg.unbuild;
      }

      // 4. Track npm scripts invoking unbuild CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("unbuild") || scriptContent.includes("unbuild "))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("unbuild");
          }
        }
      }

      // 5. Inspect JSON-based config files (build.config.json) for entries
      if (!unbuildConfig) {
        const content = await adapter.readFile("build.config.json");
        if (content) {
          const parsed = parseJsonc(content);
          if (parsed) {
            unbuildConfig = parsed;
          }
        }
      }

      // 6. Extract entries from configuration object
      if (unbuildConfig) {
        processUnbuildConfigObj(unbuildConfig, adapter);
      }

      // 7. Report missing dependency if configuration exists without unbuild package
      if (hasConfigFile && !hasUnbuild) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "unbuild configuration found, but 'unbuild' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.unbuild },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect unbuild configuration files
      if (UNBUILD_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("unbuild");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = UNBUILD_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for unbuild
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "unbuild" || source === "mkdist") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In unbuild configuration files (build.config.ts / build.config.js)
      if (isConfigFile) {
        let configExpr: any = null;

        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("unbuild");
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
          adapter.markPackageAsUsed("unbuild");
          configExpr = node.right;
        }

        if (configExpr) {
          const processObject = (objExpr: any) => {
            if (!t.isObjectExpression(objExpr)) return;

            objExpr.properties.forEach((prop: any) => {
              if (!t.isObjectProperty(prop)) return;

              const keyName = t.isIdentifier(prop.key)
                ? prop.key.name
                : t.isStringLiteral(prop.key)
                  ? prop.key.value
                  : null;
              if (keyName) {
                // Unbuild consumes these configuration members through its
                // config loader, even when no local JS/TS code reads them.
                adapter.markConfigMemberAsUsed(fileId, "default", keyName);
              }

              if (keyName === "entries") {
                const val = prop.value;
                if (t.isArrayExpression(val)) {
                  val.elements.forEach((el: any) => {
                    // String entry: entries: ['./src/index']
                    if (t.isStringLiteral(el)) {
                      adapter.markAsUsed(el.value);
                    }
                    // Object entry: entries: [{ input: './src/index', name: 'main' }]
                    else if (t.isObjectExpression(el)) {
                      el.properties.forEach((p: any) => {
                        if (
                          t.isObjectProperty(p) &&
                          t.isIdentifier(p.key) &&
                          ["input", "builder"].includes(p.key.name) &&
                          t.isStringLiteral(p.value)
                        ) {
                          adapter.markAsUsed(p.value.value);
                        }
                      });
                    }
                  });
                }
              }
            });
          };

          // Unwrap defineBuildConfig(...) call expressions
          if (t.isCallExpression(configExpr)) {
            const firstArg = configExpr.arguments[0];

            if (t.isObjectExpression(firstArg)) {
              processObject(firstArg);
            } else if (t.isArrayExpression(firstArg)) {
              firstArg.elements.forEach((el: any) => {
                if (t.isObjectExpression(el)) {
                  processObject(el);
                }
              });
            }
          } else if (t.isObjectExpression(configExpr)) {
            processObject(configExpr);
          } else if (t.isArrayExpression(configExpr)) {
            configExpr.elements.forEach((el: any) => {
              if (t.isObjectExpression(el)) {
                processObject(el);
              }
            });
          }
        }
      }
    },
  },
};

function processUnbuildConfigObj(config: any, adapter: any): void {
  if (typeof config !== "object" || config === null) return;

  const entries = config.entries;
  if (Array.isArray(entries)) {
    entries.forEach((entry: any) => {
      if (typeof entry === "string") {
        adapter.markAsUsed(entry);
      } else if (typeof entry === "object" && entry !== null) {
        if (typeof entry.input === "string") {
          adapter.markAsUsed(entry.input);
        }
      }
    });
  }
}

export default UnbuildPlugin;
