import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SVGO_CONFIG_FILES = [
  "svgo.config.js",
  "svgo.config.mjs",
  "svgo.config.cjs",
  "svgo.config.ts",
  "svgo.config.mts",
  "svgo.config.cts",
  ".svgorc",
  ".svgorc.json",
  ".svgorc.yaml",
  ".svgorc.yml",
  ".svgorc.js",
  ".svgorc.cjs"
];

const SVGO_PACKAGES = ["svgo"];

export const SvgoPlugin: AnalyzerPlugin = {
  name: "svgo-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (SVGO_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("svgo") || s === "svgo")
          )
        ) {
          return true;
        }
      }
    }

    for (const configFile of SVGO_CONFIG_FILES) {
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

      const hasSvgo = "svgo" in allDeps;

      // 1. Safeguard installed SVGO packages in package.json
      if (hasSvgo) {
        adapter.markPackageAsUsed("svgo");
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of SVGO_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Track npm scripts invoking SVGO CLI (e.g., "optimize:svg": "svgo -f src/assets")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("svgo") || scriptContent === "svgo")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("svgo");
          }
        }
      }

      // 4. Emit finding if configuration file exists without svgo dependency
      if (hasConfigFile && !hasSvgo) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "SVGO configuration found, but 'svgo' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (SVGO_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("svgo");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SVGO_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for svgo
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "svgo" || source.startsWith("svgo/")) {
          adapter.markPackageAsUsed("svgo");
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect CJS require('svgo') calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg) && arg.value === "svgo") {
          adapter.markPackageAsUsed("svgo");
          adapter.markAsUsed(fileId);
        }
      }

      // 3. Detect optimize(...) call expressions
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "optimize"
      ) {
        adapter.markPackageAsUsed("svgo");
      }

      // 4. In SVGO config files (svgo.config.js / svgo.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("svgo");
        }

        // CJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("svgo");
        }
      }
    }
  }
};

export default SvgoPlugin;