import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const LINT_STAGED_CONFIG_FILES = [
  ".lintstagedrc",
  ".lintstagedrc.json",
  ".lintstagedrc.yaml",
  ".lintstagedrc.yml",
  ".lintstagedrc.js",
  ".lintstagedrc.cjs",
  ".lintstagedrc.mjs",
  ".lintstagedrc.ts",
  "lint-staged.config.js",
  "lint-staged.config.cjs",
  "lint-staged.config.mjs",
  "lint-staged.config.ts",
];

export const LintStagedPlugin: AnalyzerPlugin = {
  name: "lint-staged-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (
      pkg &&
      (pkg.devDependencies?.["lint-staged"] ||
        pkg.dependencies?.["lint-staged"] ||
        pkg["lint-staged"] ||
        pkg.lintstaged)
    ) {
      return true;
    }

    for (const configFile of LINT_STAGED_CONFIG_FILES) {
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

      const hasLintStagedDep = !!allDeps["lint-staged"];

      let hasConfigFile = false;
      for (const configFile of LINT_STAGED_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
          break;
        }
      }

      if (pkg?.["lint-staged"] || pkg?.lintstaged) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "lint-staged");
      }

      // Mark package.json scripts that invoke lint-staged
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("lint-staged")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasLintStagedDep) {
        adapter.markPackageAsUsed("lint-staged");
      }

      if (hasConfigFile && !hasLintStagedDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "lint-staged configuration found but 'lint-staged' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (LINT_STAGED_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("lint-staged");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = LINT_STAGED_CONFIG_FILES.includes(basename);

      if (!isConfigFile) return;

      // 1. Mark exports in JS/TS config files
      if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
        adapter.markAsUsed(fileId);
      }

      // 2. Extract referenced packages/CLI commands inside config string literals (e.g. "eslint --fix", "prettier --write")
      if (t.isStringLiteral(node) || (node.type === "Literal" && typeof node.value === "string")) {
        const cmdStr = node.value.trim();
        if (cmdStr && !cmdStr.startsWith(".") && !cmdStr.startsWith("/")) {
          const firstWord = cmdStr.split(/\s+/)[0];
          if (firstWord && !firstWord.startsWith("-")) {
            adapter.markPackageAsUsed(firstWord);
          }
        }
      }
    },
  },
};

export default LintStagedPlugin;
