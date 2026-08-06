import { AnalyzerPlugin } from "../types.js";

const LINT_STAGED_FILES = [".lintstagedrc", ".lintstagedrc.json", ".lintstagedrc.yaml", "lint-staged.config.js"];

export const LintStagedPlugin: AnalyzerPlugin = {
  name: "lint-staged-plugin",
  version: "1.1.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["lint-staged"] || pkg?.lintstaged);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      // Falls lint-staged in der package.json definiert ist, schütze den Key
      if (pkg?.["lint-staged"] || pkg?.lintstaged) {
        adapter.markAsUsed("package.json", "lint-staged");
      }
    },
    onFileStart: (fileId, adapter) => {
      if (LINT_STAGED_FILES.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    },
    onASTNode: (node, fileId, adapter) => {
      // Schützt die Logik in JS-basierten lint-staged Konfigurationen
      if (fileId.includes("lint-staged.config.")) {
        if (node.type === "ExportDefaultDeclaration" || node.type === "ExportNamedDeclaration") {
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default LintStagedPlugin;
