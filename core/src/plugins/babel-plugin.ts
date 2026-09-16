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
  ".babelrc.json",
];

const CORE_BABEL_PACKAGES = [
  "@babel/core",
  "@babel/cli",
  "@babel/runtime",
  "@babel/register",
  "@babel/standalone",
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
  if (raw === "transform-runtime") return "@babel/plugin-transform-runtime";
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

function markBabelReference(
  raw: string,
  kind: "preset" | "plugin",
  fileId: string,
  adapter: any,
): void {
  if (raw.startsWith(".")) {
    adapter.markRelativeFileAsUsed(fileId, raw);
    return;
  }

  const resolved = kind === "preset" ? resolveBabelPreset(raw) : resolveBabelPlugin(raw);
  adapter.markPackageAsUsed(resolved);
  if (resolved === "@babel/plugin-transform-runtime") {
    adapter.markPackageAsUsed("@babel/runtime");
  }
  adapter.markPackageAsUsed("@babel/core");
}

function markBabelConfigReferences(value: unknown, fileId: string, adapter: any): void {
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === "string") {
      markBabelReference(first, "plugin", fileId, adapter);
      return;
    }
    for (const item of value) markBabelConfigReferences(item, fileId, adapter);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "presets" || key === "plugins") {
      for (const item of Array.isArray(child) ? child : [child]) {
        const raw = Array.isArray(item) ? item[0] : item;
        if (typeof raw === "string") {
          markBabelReference(raw, key === "presets" ? "preset" : "plugin", fileId, adapter);
        }
      }
    } else {
      markBabelConfigReferences(child, fileId, adapter);
    }
  }
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
        ...pkg?.peerDependencies,
      };

      const hasBabelDep = CORE_BABEL_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const file of BABEL_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          adapter.addEntryPatterns([file]);
          adapter.markPackageAsUsed("@babel/core");
          if (file.endsWith(".json")) {
            const config = await adapter.readJson(file);
            if (config) markBabelConfigReferences(config, file, adapter);
          }
        }
      }

      if (pkg?.babel) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "babel");
        adapter.addEntryPatterns(["package.json"]);
        adapter.markPackageAsUsed("@babel/core");
      }

      // Mark core installed Babel packages
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

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
          message:
            "Babel configuration found but '@babel/core' or '@babel/cli' is not listed in package.json.",
          evidence: { hasConfigFile },
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
              if (
                t.isStringLiteral(el) ||
                (el.type === "Literal" && typeof el.value === "string")
              ) {
                presetName = el.value;
              } else if (t.isArrayExpression(el) && el.elements[0]) {
                const first = el.elements[0];
                if (
                  t.isStringLiteral(first) ||
                  (first.type === "Literal" && typeof first.value === "string")
                ) {
                  presetName = first.value;
                }
              }

              if (presetName) markBabelReference(presetName, "preset", fileId, adapter);
            });
          }

          // Handle "plugins": [...]
          if (keyName === "plugins" && t.isArrayExpression(node.value)) {
            node.value.elements.forEach((el: any) => {
              let pluginName: string | null = null;
              if (
                t.isStringLiteral(el) ||
                (el.type === "Literal" && typeof el.value === "string")
              ) {
                pluginName = el.value;
              } else if (t.isArrayExpression(el) && el.elements[0]) {
                const first = el.elements[0];
                if (
                  t.isStringLiteral(first) ||
                  (first.type === "Literal" && typeof first.value === "string")
                ) {
                  pluginName = first.value;
                }
              }

              if (pluginName) markBabelReference(pluginName, "plugin", fileId, adapter);
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
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
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
              "parse",
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
          if (
            ["transformFileSync", "transformSync", "parseSync", "transform", "parse"].includes(
              funcName,
            )
          ) {
            adapter.markAsUsed(fileId);
            adapter.markPackageAsUsed("@babel/core");
          }
        }
      }

      // 5. Detect @babel/traverse usage
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "traverse"
      ) {
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
    },
  },
};

export default BabelPlugin;
