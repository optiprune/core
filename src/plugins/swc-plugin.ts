import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SWC_CONFIG_FILES = [
  ".swcrc",
  ".swcrc.json",
  "swc.config.js",
  "swc.config.cjs",
  "swc.config.mjs",
  "swc.config.json"
];

const SWC_PACKAGES = [
  "@swc/core",
  "@swc/cli",
  "@swc/wasm",
  "@swc/jest",
  "@swc/register",
  "@swc/helpers",
  "swc-loader",
  "unplugin-swc"
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

export const SwcPlugin: AnalyzerPlugin = {
  name: "swc-plugin",
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
            dep === "swc-loader" ||
            dep.startsWith("@swc/") ||
            dep.startsWith("swc-")
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("swc ") || s === "swc")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of SWC_CONFIG_FILES) {
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

      const hasSwc = Object.keys(allDeps).some(
        (p) => p === "swc-loader" || p.startsWith("@swc/") || p.startsWith("swc-")
      );

      // 1. Safeguard installed SWC packages and plugins in package.json
      if (hasSwc) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "swc-loader" ||
            depName.startsWith("@swc/") ||
            depName.startsWith("swc-")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of SWC_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking SWC CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("swc ") || scriptContent === "swc")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("@swc/cli");
          }
        }
      }

      // 4. Extract SWC WASM plugins inside .swcrc (jsc.experimental.plugins)
      const swcRcContent = await adapter.readFile(".swcrc");
      if (swcRcContent) {
        const swcRc = parseJsonc(swcRcContent);
        const plugins = swcRc?.jsc?.experimental?.plugins;
        if (Array.isArray(plugins)) {
          plugins.forEach((pluginEntry: any) => {
            let pluginName: string | null = null;
            if (typeof pluginEntry === "string") {
              pluginName = pluginEntry;
            } else if (Array.isArray(pluginEntry) && typeof pluginEntry[0] === "string") {
              pluginName = pluginEntry[0];
            }

            if (pluginName) {
              adapter.markPackageAsUsed(pluginName);
            }
          });
        }
      }

      // 5. Emit finding if config file is present without @swc/core or @swc/cli
      if (hasConfigFile && !hasSwc) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "SWC configuration found, but '@swc/core' or '@swc/cli' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect SWC configuration files
      if (SWC_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@swc/core");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SWC_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for @swc/* packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "swc-loader" ||
          source.startsWith("@swc/") ||
          source.startsWith("swc-")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('@swc/core') calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "swc-loader" || arg.value.startsWith("@swc/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect SWC programmatic API usage: swc.transform, swc.transformSync, swc.parse, swc.bundle
      if (t.isCallExpression(node)) {
        if (t.isMemberExpression(node.callee)) {
          const obj = node.callee.object;
          const prop = node.callee.property;
          if (t.isIdentifier(obj) && t.isIdentifier(prop)) {
            if (
              ["transform", "transformSync", "parse", "parseSync", "bundle", "minify", "minifySync"].includes(
                prop.name
              )
            ) {
              adapter.markAsUsed(fileId);
              adapter.markPackageAsUsed("@swc/core");
            }
          }
        }
      }

      // 4. In JavaScript SWC config files (swc.config.js / swc.config.cjs)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("@swc/core");
        }

        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("@swc/core");
        }
      }
    }
  }
};

export default SwcPlugin;