import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized mdxlint configuration files
 */
const MDXLINT_CONFIG_FILES = [
  ".mdxlintrc",
  ".mdxlintrc.json",
  ".mdxlintrc.yaml",
  ".mdxlintrc.yml",
  ".mdxlintrc.js",
  ".mdxlintrc.cjs",
  "mdxlint.config.js",
  "mdxlint.config.mjs",
  "mdxlint.config.cjs",
  "mdxlint.config.ts",
];

const MDXLINT_PACKAGES = ["mdxlint", "@mdxlint/core", "@mdxlint/cli", "eslint-plugin-mdx"];

/**
 * Helper to process mdxlint configuration objects and extract custom rules/plugins
 */
function processMdxlintConfig(config: Record<string, any>, adapter: any): void {
  if (!config || typeof config !== "object") return;

  // Process rules / plugins if custom rule packages are specified
  if (config.plugins && Array.isArray(config.plugins)) {
    for (const plugin of config.plugins) {
      if (typeof plugin === "string") {
        const pkgName = plugin.startsWith("mdxlint-plugin-") ? plugin : `mdxlint-plugin-${plugin}`;
        adapter.markPackageAsUsed(pkgName);
      }
    }
  }

  // Protect custom extends configurations
  if (config.extends) {
    const extendsList = Array.isArray(config.extends) ? config.extends : [config.extends];
    for (const ext of extendsList) {
      if (typeof ext === "string" && !ext.startsWith(".") && !ext.startsWith("/")) {
        adapter.markPackageAsUsed(ext);
      }
    }
  }
}

export const MdxlintPlugin: AnalyzerPlugin = {
  name: "mdxlint-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated mdxlint config files
    for (const configFile of MDXLINT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependencies, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.mdxlint) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (
        Object.keys(allDeps).some(
          (dep) =>
            dep === "mdxlint" || dep.startsWith("@mdxlint/") || dep.startsWith("mdxlint-plugin-"),
        )
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bmdxlint\b/.test(s) || s.includes("mdxlint ")),
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated mdxlint configuration files
      for (const configFile of MDXLINT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect mdxlint, @mdxlint/*, and mdxlint-plugin-* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "mdxlint" ||
            depName.startsWith("@mdxlint/") ||
            depName.startsWith("mdxlint-plugin-")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 3. Process inline package.json#mdxlint block
        if (pkg.mdxlint) {
          adapter.markAsUsed("package.json", "mdxlint");
          processMdxlintConfig(pkg.mdxlint, adapter);
        }

        // 4. Mark scripts executing mdxlint CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bmdxlint\b/.test(scriptContent) || scriptContent.includes("mdxlint "))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse .mdxlintrc or .mdxlintrc.json if present
      const jsonConfigFile = (await adapter.folderExists(".mdxlintrc.json"))
        ? ".mdxlintrc.json"
        : (await adapter.folderExists(".mdxlintrc"))
          ? ".mdxlintrc"
          : null;

      if (jsonConfigFile) {
        const configData = await adapter.readJson(jsonConfigFile);
        if (configData) {
          processMdxlintConfig(configData, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (MDXLINT_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS/TS config files (mdxlint.config.js, .mdxlintrc.js, etc.)
      if (basename.startsWith("mdxlint.config.") || basename.startsWith(".mdxlintrc.")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }
      }

      // Retain imports from mdxlint or @mdxlint/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "mdxlint" || source.startsWith("@mdxlint/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default MdxlintPlugin;
