import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const ESLINT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.ts",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc.json",
  ".eslintrc",
  ".eslintignore"
];

/**
 * Normalizes legacy ESLint plugin shorthands to actual npm package names.
 */
function resolvePluginPackage(raw: string): string | null {
  if (raw.startsWith("eslint-plugin-")) return raw;
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    const scope = parts[0];
    const name = parts[1];

    if (!scope) return null;
    if (parts.length === 1) return `${scope}/eslint-plugin`;
    if (parts.length === 2 && name) {
      if (name.startsWith("eslint-plugin-")) return raw;
      return `${scope}/eslint-plugin-${name}`;
    }
  }
  return `eslint-plugin-${raw}`;
}

/**
 * Normalizes legacy ESLint config shorthands to actual npm package names.
 */
function resolveConfigPackage(raw: string): string | null {
  if (raw.startsWith("eslint-config-")) return raw;
  if (raw.startsWith("plugin:")) {
    const pluginPart = raw.slice(7).split("/")[0];
    return pluginPart ? resolvePluginPackage(pluginPart) : null;
  }
  if (raw.startsWith("@")) {
    const parts = raw.split("/");
    const scope = parts[0];
    const name = parts[1];

    if (!scope) return null;
    if (parts.length === 1) return `${scope}/eslint-config`;
    if (parts.length === 2 && name) {
      if (name.startsWith("eslint-config-")) return raw;
      return `${scope}/eslint-config-${name}`;
    }
  }
  return `eslint-config-${raw}`;
}

export const EslintPlugin: AnalyzerPlugin = {
  name: "eslint-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.dependencies?.["eslint"] || pkg.devDependencies?.["eslint"] || pkg.eslintConfig) {
        return true;
      }
    }
    for (const file of ESLINT_CONFIG_FILES) {
      if (await adapter.folderExists(file)) return true;
    }
    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasEslintDep = pkg ? !!(pkg.dependencies?.["eslint"] || pkg.devDependencies?.["eslint"]) : false;

      let hasConfigFile = false;
      for (const file of ESLINT_CONFIG_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
          break;
        }
      }

      if (pkg?.eslintConfig) {
        hasConfigFile = true;
      }

      // Check npm scripts invoking eslint
      if (pkg?.scripts) {
        for (const [name, script] of Object.entries(pkg.scripts)) {
          if (typeof script === "string" && script.includes("eslint")) {
            adapter.markAsUsed("package.json", `scripts:${name}`);
          }
        }
      }

      if (hasConfigFile && !hasEslintDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "ESLint configuration found but 'eslint' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      
      if (ESLINT_CONFIG_FILES.some((f) => normalized.endsWith(f))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("eslint");
      }

      // Mark custom rules directory as used
      if (normalized.includes("rules/") && /\.[jt]sx?$/.test(normalized)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const isConfigFile = ESLINT_CONFIG_FILES.some((f) => fileId.endsWith(f));
      if (!isConfigFile) return;

      // 1. Detect ESLint imports (Flat Config v9+ style imports)
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source.includes("eslint") ||
          source.startsWith("@typescript-eslint/") ||
          source.startsWith("@stylistic/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markPackageAsUsed("eslint");
        }
      }

      // 2. Detect require("...") calls in CJS ESLint configs
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const val = arg.value;
          if (val.includes("eslint") || val.startsWith("@typescript-eslint/")) {
            adapter.markPackageAsUsed(val);
            adapter.markPackageAsUsed("eslint");
          }
        }
      }

      // 3. Resolve Legacy Shorthands in strings (.eslintrc)
      if (t.isStringLiteral(node)) {
        const val = node.value;

        if (val.includes("eslint-plugin-") || val.startsWith("@")) {
          const pkgName = resolvePluginPackage(val);
          if (pkgName) adapter.markPackageAsUsed(pkgName);
          adapter.markPackageAsUsed("eslint");
        } else if (val.includes("eslint-config-") || val.startsWith("plugin:")) {
          const pkgName = resolveConfigPackage(val);
          if (pkgName) adapter.markPackageAsUsed(pkgName);
          adapter.markPackageAsUsed("eslint");
        }
      }
    }
  }
};

export default EslintPlugin;