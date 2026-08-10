import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const STYLELINT_FILES = [
  ".stylelintrc",
  ".stylelintrc.json",
  ".stylelintrc.yaml",
  ".stylelintrc.yml",
  ".stylelintrc.js",
  ".stylelintrc.cjs",
  ".stylelintrc.mjs",
  "stylelint.config.js",
  "stylelint.config.cjs",
  "stylelint.config.mjs",
  ".stylelintignore"
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

export const StylelintPlugin: AnalyzerPlugin = {
  name: "stylelint-plugin",
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
            dep === "stylelint" ||
            dep.startsWith("stylelint-") ||
            dep.startsWith("@stylelint/")
        ) ||
        pkg.stylelint
      ) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (s.includes("stylelint ") || s === "stylelint")
          )
        ) {
          return true;
        }
      }
    }

    for (const file of STYLELINT_FILES) {
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

      const hasStylelint = Object.keys(allDeps).some(
        (p) =>
          p === "stylelint" ||
          p.startsWith("stylelint-") ||
          p.startsWith("@stylelint/")
      );

      // 1. Safeguard all installed Stylelint packages, plugins, and configs in package.json
      if (hasStylelint) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "stylelint" ||
            depName.startsWith("stylelint-") ||
            depName.startsWith("@stylelint/")
          ) {
            adapter.markPackageAsUsed(depName);
          }
        }
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const file of STYLELINT_FILES) {
        if (await adapter.folderExists(file)) {
          hasConfigFile = true;
          adapter.markAsUsed(file);
        }
      }

      // 3. Process package.json "stylelint" block if present
      if (pkg?.stylelint) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "stylelint");
        processStylelintConfigObj(pkg.stylelint, adapter);
      }

      // 4. Track npm scripts invoking Stylelint CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("stylelint ") || scriptContent === "stylelint")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("stylelint");
          }
        }
      }

      // 5. Inspect JSON-based config files (.stylelintrc, .stylelintrc.json)
      for (const jsonConfigName of [".stylelintrc", ".stylelintrc.json"]) {
        const content = await adapter.readFile(jsonConfigName);
        if (content) {
          const config = parseJsonc(content);
          if (config) {
            processStylelintConfigObj(config, adapter);
          }
        }
      }

      // 6. Report missing dependency if configuration exists without stylelint
      if (hasConfigFile && !hasStylelint) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Stylelint configuration found, but 'stylelint' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.stylelint }
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (STYLELINT_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("stylelint");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = STYLELINT_FILES.includes(basename);

      // 1. Detect ESM imports for stylelint packages
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "stylelint" ||
          source.startsWith("stylelint-") ||
          source.startsWith("@stylelint/")
        ) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In Stylelint JS configuration files (stylelint.config.js / .stylelintrc.js)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("stylelint");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("stylelint");
        }

        // Detect extends, plugins, and customSyntax in JS-based configs
        if (t.isObjectProperty(node)) {
          const keyName =
            t.isIdentifier(node.key) ? node.key.name : (node.key as any).value;

          if (["extends", "plugins", "customSyntax"].includes(keyName)) {
            const val = node.value;
            if (t.isArrayExpression(val)) {
              val.elements.forEach((el: any) => {
                if (t.isStringLiteral(el)) {
                  adapter.markPackageAsUsed(el.value);
                }
              });
            } else if (t.isStringLiteral(val)) {
              adapter.markPackageAsUsed(val.value);
            }
          }
        }
      }
    }
  }
};

function processStylelintConfigObj(config: any, adapter: any): void {
  if (typeof config !== "object" || config === null) return;

  // Process "extends"
  if (typeof config.extends === "string") {
    adapter.markPackageAsUsed(config.extends);
  } else if (Array.isArray(config.extends)) {
    config.extends.forEach((ext: string) => {
      if (typeof ext === "string") adapter.markPackageAsUsed(ext);
    });
  }

  // Process "plugins"
  if (Array.isArray(config.plugins)) {
    config.plugins.forEach((plugin: string) => {
      if (typeof plugin === "string") adapter.markPackageAsUsed(plugin);
    });
  }

  // Process "customSyntax"
  if (typeof config.customSyntax === "string") {
    adapter.markPackageAsUsed(config.customSyntax);
  }
}

export default StylelintPlugin;