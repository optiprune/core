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
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps["eslint"] || allDeps["@nx/eslint"] || pkg.eslintConfig) {
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
      const hasEslintDep = pkg ? !!(pkg.dependencies?.["eslint"] || pkg.devDependencies?.["eslint"] || pkg.dependencies?.["@nx/eslint"] || pkg.devDependencies?.["@nx/eslint"]) : false;

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
        if (await adapter.folderExists("nx.json")) {
          adapter.markPackageAsUsed("@nx/eslint");
        } else {
          adapter.markPackageAsUsed("eslint");
        }
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
      const normalized = fileId.replace(/\\/g, "/");
      const matchedConfig = ESLINT_CONFIG_FILES.find((f) => normalized.endsWith(f));
      
      if (!matchedConfig) return;

      const isLegacyConfig = matchedConfig.startsWith(".eslintrc");

      // 1. Detect ESM Imports (Flat Config v9+ and TypeScript configs)
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (!source.startsWith(".") && !source.startsWith("/")) {
          adapter.markPackageAsUsed(source);
          adapter.markPackageAsUsed("eslint");
        }
      }

      // 2. Detect require("...") calls in CJS ESLint configs
      if (t.isCallExpression(node) && t.isIdentifier(node.callee) && node.callee.name === "require") {
        const arg = node.arguments[0];
        if (t.isStringLiteral(arg)) {
          const val = arg.value;
          if (!val.startsWith(".") && !val.startsWith("/")) {
            adapter.markPackageAsUsed(val);
            adapter.markPackageAsUsed("eslint");
          }
        }
      }

      // Flat-config resolver shorthands can be object keys (`typescript: true`)
      // rather than string literals. Map those keys to resolver packages too.
      if ((node.type === "ObjectProperty" || node.type === "Property") && !node.computed) {
        const keyName = node.key?.name ?? node.key?.value;
        if (keyName === "typescript") adapter.markPackageAsUsed("eslint-import-resolver-typescript");
        if (keyName === "node") adapter.markPackageAsUsed("eslint-import-resolver-node");
        if (keyName === "webpack") adapter.markPackageAsUsed("eslint-import-resolver-webpack");
      }

      // Flat-config resolver shorthands are strings nested in settings, not
      // imports. Map the well-known resolver names to their npm packages.
      if (t.isStringLiteral(node)) {
        const resolverPackages: Record<string, string> = {
          typescript: "eslint-import-resolver-typescript",
          node: "eslint-import-resolver-node",
          webpack: "eslint-import-resolver-webpack",
        };
        const resolverPackage = resolverPackages[node.value] ??
          (node.value.startsWith("eslint-import-resolver-") ? node.value : undefined);
        if (resolverPackage) adapter.markPackageAsUsed(resolverPackage);
      }

      // 3. Resolve Legacy Shorthands in strings ONLY for .eslintrc* files
      if (isLegacyConfig && t.isStringLiteral(node)) {
        const val = node.value;

        // Skip path references, globs, or non-package strings
        if (
          val.startsWith(".") ||
          val.startsWith("/") ||
          val.includes("*") ||
          val === "error" ||
          val === "warn" ||
          val === "off"
        ) {
          return;
        }

        if (val.startsWith("plugin:")) {
          const pkgName = resolveConfigPackage(val);
          if (pkgName) adapter.markPackageAsUsed(pkgName);
          adapter.markPackageAsUsed("eslint");
        } else if (val.includes("eslint-config-")) {
          adapter.markPackageAsUsed(val);
          adapter.markPackageAsUsed("eslint");
        } else if (val.includes("eslint-plugin-")) {
          adapter.markPackageAsUsed(val);
          adapter.markPackageAsUsed("eslint");
        } else {
          // Attempt resolving bare shorthands (e.g. "airbnb", "react", "@typescript-eslint")
          const pluginPkg = resolvePluginPackage(val);
          const configPkg = resolveConfigPackage(val);
          
          if (pluginPkg) adapter.markPackageAsUsed(pluginPkg);
          if (configPkg) adapter.markPackageAsUsed(configPkg);
          adapter.markPackageAsUsed("eslint");
        }
      }
    }
  }
};

export default EslintPlugin;