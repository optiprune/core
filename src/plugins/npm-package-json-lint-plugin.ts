import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized npm-package-json-lint config file locations (in order of precedence)
 */
const NPM_PACKAGE_JSON_LINT_CONFIG_FILES = [
  ".npmpackagejsonlintrc.js",
  ".npmpackagejsonlintrc.cjs",
  "npmpackagejsonlint.config.js",
  "npmpackagejsonlint.config.cjs",
  ".npmpackagejsonlintrc.json",
  ".npmpackagejsonlintrc",
  ".npmpackagejsonlintrc.yaml",
  ".npmpackagejsonlintrc.yml",
  ".npmpackagejsonlintignore"
];

const NPM_PACKAGE_JSON_LINT_PACKAGE_NAME = "npm-package-json-lint";

/**
 * Helper to register extended shared config packages (e.g. "npm-package-json-lint-config-default")
 */
function processExtends(extendsValue: unknown, adapter: any): void {
  if (typeof extendsValue === "string") {
    adapter.markPackageAsUsed(extendsValue);
  } else if (Array.isArray(extendsValue)) {
    for (const entry of extendsValue) {
      if (typeof entry === "string") {
        adapter.markPackageAsUsed(entry);
      }
    }
  }
}

export const NpmPackageJsonLintPlugin: AnalyzerPlugin = {
  name: "npm-package-json-lint-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    // 1. Check for dedicated config or ignore files
    for (const configFile of NPM_PACKAGE_JSON_LINT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependency, or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg.npmpackagejsonlint) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies
      };

      if (allDeps[NPM_PACKAGE_JSON_LINT_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (/\bnpm-package-json-lint\b/.test(s) || /\bnpm-pkg-lint\b/.test(s))
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

      // 1. Protect dedicated configuration & ignore files
      for (const configFile of NPM_PACKAGE_JSON_LINT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect primary npm-package-json-lint package
        const isDep =
          (pkg.dependencies && pkg.dependencies[NPM_PACKAGE_JSON_LINT_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[NPM_PACKAGE_JSON_LINT_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[NPM_PACKAGE_JSON_LINT_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(NPM_PACKAGE_JSON_LINT_PACKAGE_NAME);
        }

        // 3. Process inline package.json#npmpackagejsonlint configuration block
        if (pkg.npmpackagejsonlint) {
          adapter.markAsUsed("package.json", "npmpackagejsonlint");

          if (pkg.npmpackagejsonlint.extends) {
            processExtends(pkg.npmpackagejsonlint.extends, adapter);
          }
        }

        // 4. Mark scripts invoking npm-package-json-lint CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bnpm-package-json-lint\b/.test(scriptContent) ||
                /\bnpm-pkg-lint\b/.test(scriptContent))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }

      // 5. Parse standalone JSON config files for `extends` packages
      const jsonConfigFile =
        (await adapter.folderExists(".npmpackagejsonlintrc.json"))
          ? ".npmpackagejsonlintrc.json"
          : (await adapter.folderExists(".npmpackagejsonlintrc"))
          ? ".npmpackagejsonlintrc"
          : null;

      if (jsonConfigFile) {
        const rcConfig = await adapter.readJson(jsonConfigFile);
        if (rcConfig?.extends) {
          processExtends(rcConfig.extends, adapter);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (NPM_PACKAGE_JSON_LINT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS configuration files (.npmpackagejsonlintrc.js, npmpackagejsonlint.config.js, etc.)
      if (
        basename.startsWith(".npmpackagejsonlintrc.") ||
        basename.startsWith("npmpackagejsonlint.config.")
      ) {
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

        // Inspect AST for property "extends": "npm-package-json-lint-config-..."
        if (
          t.isObjectProperty(node) &&
          t.isIdentifier(node.key) &&
          node.key.name === "extends"
        ) {
          if (t.isStringLiteral(node.value)) {
            adapter.markPackageAsUsed(node.value.value);
          } else if (t.isArrayExpression(node.value)) {
            for (const element of node.value.elements) {
              if (t.isStringLiteral(element)) {
                adapter.markPackageAsUsed(element.value);
              }
            }
          }
        }
      }
    }
  }
};

export default NpmPackageJsonLintPlugin;