import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const BABEL_CONFIG_FILES = [
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.json",
  ".babelrc",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.ts",
  ".babelrc.json"
];

const CORE_BABEL_PACKAGES = [
  "@babel/core",
  "@babel/cli",
  "@babel/runtime",
  "@babel/register",
  "@babel/standalone"
];

/**
 * Resolves Babel preset shorthands to actual npm package names.
 * e.g., "@babel/env" -> "@babel/preset-env", "react" -> "babel-preset-react"
 */
function resolveBabelPreset(raw: string): string {
  if (raw.startsWith("@babel/preset-") || raw.startsWith("babel-preset-")) return raw;
  if (raw.startsWith("@babel/")) {
    return `@babel/preset-${raw.slice(7)}`;
  }
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    const scope = parts[0];
    const name = parts[1];
    if (!scope) return raw;
    if (!name) return `${scope}/babel-preset`;
    if (name.startsWith("babel-preset-")) return raw;
    return `${scope}/babel-preset-${name}`;
  }
  return `babel-preset-${raw}`;
}

/**
 * Resolves Babel plugin shorthands to actual npm package names.
 * e.g., "@babel/transform-runtime" -> "@babel/plugin-transform-runtime", "styled-components" -> "babel-plugin-styled-components"
 */
function resolveBabelPlugin(raw: string): string {
  if (raw.startsWith("@babel/plugin-") || raw.startsWith("babel-plugin-")) return raw;
  if (raw.startsWith("@babel/")) {
    return `@babel/plugin-${raw.slice(7)}`;
  }
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    const scope = parts[0];
    const name = parts[1];
    if (!scope) return raw;
    if (!name) return `${scope}/babel-plugin`;
    if (name.startsWith("babel-plugin-")) return raw;
    return `${scope}/babel-plugin-${name}`;
  }
  return `babel-plugin-${raw}`;
}

export const BabelPlugin: AnalyzerPlugin = {
  name: "babel-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (CORE_BABEL_PACKAGES.some((p) => p in allDeps) || pkg.babel) {
        return true;
      }
    }

    for (const file of BABEL_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
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

      const hasBabelDep = CORE_BABEL_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const file of BABEL_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      if (pkg?.babel) {
        hasConfigFile = true;
      }

      // Mark core installed Babel packages
      if (hasBabelDep) {
        for (const pkgName of CORE_BABEL_PACKAGES) {
          if (allDeps[pkgName]) {
            adapter.markPackageAsUsed(pkgName);
          }
        }
      }

      // Mark package.json scripts that execute babel CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("babel ")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@babel/cli");
            adapter.markPackageAsUsed("@babel/core");
          }
        }
      }

      if (hasConfigFile && !hasBabelDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Babel configuration found but '@babel/core' or '@babel/cli' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      if (BABEL_CONFIG_FILES.includes(fileName)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@babel/core");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);
      const isConfigFile = BABEL_CONFIG_FILES.includes(fileName);

      // 1. Analyze Babel Configuration Files
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (t.isObjectProperty(node) || node.type === "Property") {
          const keyName = (node.key as any)?.name || (node.key as any)?.value;

          // Handle "presets": [...]
          if (keyName === "presets" && t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              let presetName: string | null = null;
              if (t.isStringLiteral(el) || (el.type === "Literal" && typeof el.value === "string")) {
                presetName = el.value;
              } else if (t.isArrayExpression(el) && el.elements[0]) {
                const first = el.elements[0];
                if (t.isStringLiteral(first) || (first.type === "Literal" && typeof first.value === "string")) {
                  presetName = first.value;
                }
              }

              if (presetName && !presetName.startsWith(".")) {
                adapter.markPackageAsUsed(resolveBabelPreset(presetName));
                adapter.markPackageAsUsed("@babel/core");
              }
            });
          }

          // Handle "plugins": [...]
          if (keyName === "plugins" && t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              let pluginName: string | null = null;
              if (t.isStringLiteral(el) || (el.type === "Literal" && typeof el.value === "string")) {
                pluginName = el.value;
              } else if (t.isArrayExpression(el) && el.elements[0]) {
                const first = el.elements[0];
                if (t.isStringLiteral(first) || (first.type === "Literal" && typeof first.value === "string")) {
                  pluginName = first.value;
                }
              }

              if (pluginName && !pluginName.startsWith(".")) {
                adapter.markPackageAsUsed(resolveBabelPlugin(pluginName));
                adapter.markPackageAsUsed("@babel/core");
              }
            });
          }
        }
      }

      // 2. Detect Imports from @babel/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source.startsWith("@babel/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect require('@babel/*')
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value.startsWith("@babel/")) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 4. Detect @babel/core API usage (transformFileSync, transformSync, parseSync, etc.)
      if (t.isCallExpression(node)) {
        if (t.isMemberExpression(node.callee)) {
          const obj = (node.callee as any).object;
          const prop = (node.callee as any).property;
          if (t.isIdentifier(obj) && t.isIdentifier(prop)) {
            const babelMethods = [
              "transformFileSync",
              "transformSync",
              "parseSync",
              "transformFile",
              "transform",
              "parse"
            ];
            if (babelMethods.includes(prop.name)) {
              adapter.markAsUsed(fileId);
              adapter.markPackageAsUsed("@babel/core");
            }
          }
        }

        // Direct Babel function calls
        if (t.isIdentifier(node.callee)) {
          const funcName = node.callee.name;
          if (["transformFileSync", "transformSync", "parseSync", "transform", "parse"].includes(funcName)) {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@babel/core");
          }
        }
      }

      // 5. Detect @babel/traverse usage
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "traverse") {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@babel/traverse");
      }

      // 6. Detect @babel/types usage (t.isXxx, t.createXxx patterns)
      if (t.isMemberExpression(node)) {
        const obj = (node as any).object;
        const prop = (node as any).property;
        if (t.isIdentifier(obj) && obj.name === "t" && t.isIdentifier(prop)) {
          const typeMethods = ["is", "create", "clone", "removeProperties", "removePropertiesDeep"];
          if (typeMethods.some((method) => prop.name.startsWith(method))) {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@babel/types");
          }
        }
      }
    }
  }
};

export default BabelPlugin;