import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized lockfile-lint configuration & ignore files
 */
const LOCKFILE_LINT_CONFIG_FILES = [
  ".lockfile-lintrc",
  ".lockfile-lintrc.json",
  ".lockfile-lintrc.yaml",
  ".lockfile-lintrc.yml",
  ".lockfile-lintrc.js",
  ".lockfile-lintrc.cjs",
  "lockfile-lint.config.js",
  "lockfile-lint.config.cjs",
];

const LOCKFILE_LINT_PACKAGE_NAME = "lockfile-lint";

export const LockfileLintPlugin: AnalyzerPlugin = {
  name: "lockfile-lint-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated lockfile-lint configuration files
    for (const configFile of LOCKFILE_LINT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json for inline config, dependency, or CLI execution scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (pkg["lockfile-lint"] || pkg.lockfileLint) return true;

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (allDeps[LOCKFILE_LINT_PACKAGE_NAME]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && /\blockfile-lint\b/.test(s))) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Mark dedicated configuration files as used
      for (const configFile of LOCKFILE_LINT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (pkg) {
        // 2. Protect primary lockfile-lint package dependency
        const isDep =
          (pkg.dependencies && pkg.dependencies[LOCKFILE_LINT_PACKAGE_NAME]) ||
          (pkg.devDependencies && pkg.devDependencies[LOCKFILE_LINT_PACKAGE_NAME]) ||
          (pkg.peerDependencies && pkg.peerDependencies[LOCKFILE_LINT_PACKAGE_NAME]);

        if (isDep) {
          adapter.markPackageAsUsed(LOCKFILE_LINT_PACKAGE_NAME);
        }

        // 3. Protect package.json inline config blocks ("lockfile-lint" or "lockfileLint")
        if (pkg["lockfile-lint"]) {
          adapter.markAsUsed("package.json", "lockfile-lint");
        }
        if (pkg.lockfileLint) {
          adapter.markAsUsed("package.json", "lockfileLint");
        }

        // 4. Mark npm scripts invoking lockfile-lint CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (typeof scriptContent === "string" && /\blockfile-lint\b/.test(scriptContent)) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect configuration files
      if (LOCKFILE_LINT_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Inspect JS configuration files (.lockfile-lintrc.js, lockfile-lint.config.js, etc.)
      if (
        basename.startsWith(".lockfile-lintrc.") ||
        basename.startsWith("lockfile-lint.config.")
      ) {
        // Mark ES module default exports
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Mark CommonJS module.exports assignments
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
    },
  },
};

export default LockfileLintPlugin;
