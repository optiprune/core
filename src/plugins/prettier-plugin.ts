import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PRETTIER_CONFIG_FILES = [
  ".prettierrc",
  ".prettierrc.json",
  ".prettierrc.yml",
  ".prettierrc.yaml",
  ".prettierrc.json5",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  ".prettierignore",
];

const PRETTIER_FILE_REGEX = /^(\.)?prettier(rc|\.config)/;

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

export const PrettierPlugin: AnalyzerPlugin = {
  name: "prettier-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies and prettier config field
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
            dep === "prettier" ||
            dep.startsWith("prettier-plugin-") ||
            dep.startsWith("@prettier/"),
        ) ||
        pkg.prettier
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("prettier ") || s === "prettier"),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files in root
    for (const configFile of PRETTIER_CONFIG_FILES) {
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

      const hasPrettier = Object.keys(allDeps).some(
        (p) => p === "prettier" || p.startsWith("prettier-plugin-") || p.startsWith("@prettier/"),
      );

      // 1. Safeguard all installed Prettier plugins and packages in package.json
      if (hasPrettier) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "prettier" ||
            depName.startsWith("prettier-plugin-") ||
            depName.startsWith("@prettier/")
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of PRETTIER_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "prettier" block if present
      let prettierConfig: any = null;
      if (pkg?.prettier) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "prettier");
        prettierConfig = pkg.prettier;
      }

      // 4. Track npm scripts invoking Prettier CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("prettier ") || scriptContent === "prettier")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("prettier");
          }
        }
      }

      // 5. Inspect JSON-based config files (.prettierrc, .prettierrc.json) for plugins
      if (!prettierConfig) {
        for (const jsonConfigName of [".prettierrc", ".prettierrc.json", ".prettierrc.json5"]) {
          const content = await adapter.readFile(jsonConfigName);
          if (content) {
            const parsed = parseJsonc(content);
            if (parsed) {
              prettierConfig = parsed;
              break;
            }
          }
        }
      }

      // 6. Protect local file plugins and mark external plugins as packages
      if (prettierConfig && Array.isArray(prettierConfig.plugins)) {
        for (const pluginName of prettierConfig.plugins) {
          if (typeof pluginName === "string") {
            if (pluginName.startsWith(".") || pluginName.startsWith("/")) {
              adapter.markAsUsed(pluginName);
            } else {
              adapter.markPackageAsUsed(pluginName);
            }
          }
        }
      }

      // 7. Report missing dependency if configuration exists without prettier package
      if (hasConfigFile && !hasPrettier) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Prettier configuration found, but 'prettier' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.prettier },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);

      // Mark Prettier config and .prettierignore as used entry points
      if (PRETTIER_FILE_REGEX.test(fileName)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("prettier");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const fileName = path.basename(normalized);
      const isConfigFile = PRETTIER_FILE_REGEX.test(fileName);

      // 1. Detect ESM imports for prettier packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "prettier" ||
          source.startsWith("prettier-plugin-") ||
          source.startsWith("@prettier/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In JavaScript Prettier config files (prettier.config.js / .prettierrc.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("prettier");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("prettier");
        }

        // Search for plugins in JS configuration objects
        if (t.isObjectProperty(node)) {
          const keyName = t.isIdentifier(node.key) ? node.key.name : (node.key as any).value;

          if (keyName === "plugins") {
            const val = node.value;
            if (t.isArrayExpression(val)) {
              val.elements.forEach((el: any) => {
                if (t.isStringLiteral(el)) {
                  const pluginName = el.value;
                  if (pluginName.startsWith(".") || pluginName.startsWith("/")) {
                    adapter.markAsUsed(pluginName);
                  } else {
                    adapter.markPackageAsUsed(pluginName);
                  }
                }
              });
            }
          }
        }
      }
    },
  },
};

export default PrettierPlugin;
