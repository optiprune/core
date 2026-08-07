import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const SIMPLE_GIT_HOOKS_CONFIG_FILES = [".simple-git-hooks.json", "simple-git-hooks.json"];

export const SimpleGitHooksPlugin: AnalyzerPlugin = {
  name: "simple-git-hooks-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["simple-git-hooks"] || pkg["simple-git-hooks"])) {
      return true;
    }
    for (const file of SIMPLE_GIT_HOOKS_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasHookDep = pkg ? !!(pkg.devDependencies?.["simple-git-hooks"]) : false;
      
      let hasConfigFile = false;
      for (const file of SIMPLE_GIT_HOOKS_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }
      if (pkg?.["simple-git-hooks"]) hasConfigFile = true;

      if (hasConfigFile && !hasHookDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "simple-git-hooks configuration found but 'simple-git-hooks' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (SIMPLE_GIT_HOOKS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default SimpleGitHooksPlugin;
