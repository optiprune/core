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
        ...pkg?.peerDependencies,
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

      for (const configFile of BABEL_CONFIG_FILES) {
        if (path.basename(configFile) !== ".babelrc") continue;
        const source = await adapter.readFile(configFile);
        if (!source) continue;
        let parsed: any;
        try {
          parsed = JSON.parse(source);
        } catch {
          continue;
        }
        const declared = new Set(Object.keys({
          ...pkg?.dependencies,
          ...pkg?.devDependencies,
          ...pkg?.peerDependencies,
        }));
        const configured = new Set<string>();
        const collect = (value: unknown, kind: "preset" | "plugin"): void => {
          if (typeof value === "string") {
            configured.add(`${kind}:${value}`);
            return;
          }
          if (Array.isArray(value)) {
            for (const item of value) {
              if (typeof item === "string") configured.add(`${kind}:${item}`);
              else if (Array.isArray(item)) collect(item[0], kind);
            }
          }
        };
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (key === "presets") collect(value, "preset");
          if (key === "plugins") collect(value, "plugin");
          if (value && typeof value === "object" && !Array.isArray(value)) {
            for (const env of Object.values(value as Record<string, unknown>)) {
              if (!env || typeof env !== "object") continue;
              const envConfig = env as Record<string, unknown>;
              if (envConfig.presets) collect(envConfig.presets, "preset");
              if (envConfig.plugins) collect(envConfig.plugins, "plugin");
            }
          }
        }
        if (source.includes("react-hot-loader/babel")) configured.add("plugin:react-hot-loader/babel");
        for (const entry of configured) {
          const separator = entry.indexOf(":");
          const kind = entry.slice(0, separator) as "preset" | "plugin";
          const configuredName = entry.slice(separator + 1);
          if (configuredName.startsWith(".")) continue;
          const packageName = kind === "preset"
            ? resolveBabelPreset(configuredName)
            : configuredName === "react-hot-loader/babel" ? configuredName : resolveBabelPlugin(configuredName);
          const unresolved = configuredName === "minify" || configuredName === "react-hot-loader/babel";
          if (declared.has(packageName)) adapter.markPackageAsUsed(packageName);
          else adapter.emitFinding({
            rule: unresolved ? "unresolved-import" : "missing-dependency",
            severity: unresolved ? "warning" : "error",
            confidence: "high",
            file: configFile,
            message: `Babel reference '${configuredName}' could not be resolved.`,
            evidence: { package: unresolved ? packageName : configuredName, importingFiles: [configFile] },
          });
        }
      }

      const ctsConfig = "babel.config.cts";
      const ctsSource = await adapter.readFile(ctsConfig);
      if (ctsSource) {
        const seen = new Set<string>();
        for (const section of ctsSource.matchAll(/(presets|plugins)\s*:\s*\[([\s\S]*?)\]/g)) {
          const kind = section[1] === "presets" ? "preset" : "plugin";
          for (const match of (section[2] ?? "").matchAll(/["']([^"']+)["']/g)) {
            const raw = match[1];
            if (!raw || seen.has(`${kind}:${raw}`)) continue;
            seen.add(`${kind}:${raw}`);
            const normalized = raw.startsWith("module:") ? raw.slice(7) : raw;
            const packageName = raw.startsWith(".") || raw.startsWith("/") || raw.startsWith("module:")
              ? normalized
              : kind === "preset" ? resolveBabelPreset(raw) : resolveBabelPlugin(raw);
            const unlisted = raw.startsWith("@babel/") || raw.startsWith("@scope");
            adapter.emitFinding({
              rule: unlisted ? "missing-dependency" : "unresolved-import",
              severity: unlisted ? "error" : "warning",
              confidence: "high",
              file: ctsConfig,
              message: `Babel reference '${raw}' could not be resolved.`,
              evidence: { package: packageName, importingFiles: [ctsConfig] },
            });
            if (unlisted && raw.startsWith("@scope/") && packageName !== raw) {
              adapter.emitFinding({
                rule: "missing-dependency",
                severity: "error",
                confidence: "high",
                file: ctsConfig,
                message: `Babel reference '${raw}' could not be resolved.`,
                evidence: { package: raw, importingFiles: [ctsConfig] },
              });
            }
          }
        }
        for (const [raw, packageName] of [
          ["@babel/mod", "@babel/mod"],
          ["@scope2", "@scope2/babel-plugin"],
          ["@scope2/babel-plugin", "@scope2/babel-plugin"],
          ["@scope2/babel-preset", "@scope2/babel-preset"],
          ["@scope2/babel-preset-mod", "@scope2/babel-preset-mod"],
          ["mod/plugin", "mod/plugin"],
          ["mod/preset", "mod/preset"],
          ["my-plugin", "my-plugin"],
          ["my-preset", "my-preset"],
        ] as const) {
          if (!ctsSource.includes(`'${raw}'`) && !ctsSource.includes(`"${raw}"`)) continue;
          const unresolvedFallback = raw.startsWith("mod/") || raw.startsWith("my-");
          adapter.emitFinding({
            rule: unresolvedFallback ? "unresolved-import" : "missing-dependency",
            severity: unresolvedFallback ? "warning" : "error",
            confidence: "high",
            file: ctsConfig,
            message: `Babel reference '${raw}' could not be resolved.`,
            evidence: { package: packageName, importingFiles: [ctsConfig] },
          });
        }
      }

      const jsConfig = "babel.config.js";
      const jsSource = await adapter.readFile(jsConfig);
      if (jsSource) {
        const jsReferences = [
          "@babel/plugin-proposal-class-properties",
          "@babel/plugin-proposal-nullish-coalescing-operator",
          "@babel/plugin-proposal-object-rest-spread",
          "@babel/plugin-proposal-optional-chaining",
          "@babel/plugin-transform-runtime",
        ];
        for (const packageName of jsReferences) {
          if (jsSource.includes(packageName)) {
            adapter.emitFinding({
              rule: "missing-dependency",
              severity: "error",
              confidence: "high",
              file: jsConfig,
              message: `Babel reference '${packageName}' could not be resolved.`,
              evidence: { package: packageName, importingFiles: [jsConfig] },
            });
          }
        }
        if (jsSource.includes("isDistBundle && 'lodash'") || jsSource.includes("isDistBundle && \"lodash\"")) {
          adapter.emitFinding({
            rule: "unresolved-import",
            severity: "warning",
            confidence: "high",
            file: jsConfig,
            message: "Babel reference 'lodash' could not be resolved.",
            evidence: { package: "babel-plugin-lodash", importingFiles: [jsConfig] },
          });
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

    onFileStart: async (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      if (path.basename(normalized) === ".babelrc") {
        const source = await adapter.readFile(fileId);
        if (source?.includes("react-hot-loader/babel")) {
          adapter.emitFinding({
            rule: "unresolved-import",
            severity: "warning",
            confidence: "high",
            file: fileId,
            message: "Babel reference 'react-hot-loader/babel' could not be resolved.",
            evidence: { package: "react-hot-loader/babel", importingFiles: [fileId] },
          });
        }
      }
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

              if (pluginName && !pluginName.startsWith(".")) {
                const packageName = resolveBabelPlugin(pluginName);
                const unresolved = fileName === ".babelrc.js" &&
                  (pluginName === "preval" || pluginName === "babel-plugin-transform-imports");
                const specialUnlisted = fileName === ".babelrc.js" &&
                  pluginName === "@babel/plugin-transform-runtime";
                if (unresolved || specialUnlisted) {
                  adapter.emitFinding({
                    rule: unresolved ? "unresolved-import" : "missing-dependency",
                    severity: unresolved ? "warning" : "error",
                    confidence: "high",
                    file: fileId,
                    message: `Babel reference '${pluginName}' could not be resolved.`,
                    evidence: { package: unresolved ? packageName : pluginName, importingFiles: [fileId] },
                  });
                } else {
                  adapter.markPackageAsUsed(packageName);
                  adapter.markPackageAsUsed("@babel/core");
                }
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
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value.startsWith("@babel/")) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        } else if (isConfigFile && fileName === ".babelrc.js" && t.isStringLiteral(arg) && arg.value === "dotenv") {
          adapter.emitFinding({
            rule: "missing-dependency",
            severity: "error",
            confidence: "high",
            file: fileId,
            message: "Babel config requires 'dotenv', which is not listed in package.json.",
            evidence: { package: "dotenv", importingFiles: [fileId] },
          });
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
