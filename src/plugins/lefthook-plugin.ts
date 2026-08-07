import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const LEFTHOOK_CONFIG_FILES = ["lefthook.yml", "lefthook.yaml", "lefthook.json"];

export const LefthookPlugin: AnalyzerPlugin = {
  name: "lefthook-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["lefthook"] || pkg.dependencies?.["lefthook"])) {
      return true;
    }
    for (const file of LEFTHOOK_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasLefthook = pkg ? !!(pkg.dependencies?.["lefthook"] || pkg.devDependencies?.["lefthook"]) : false;
      
      let hasConfigFile = false;
      for (const file of LEFTHOOK_CONFIG_FILES) {
        if ((await adapter.readFile(file)) !== null) {
          hasConfigFile = true;
          break;
        }
      }

      if (hasConfigFile && !hasLefthook) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Lefthook configuration found but 'lefthook' is not listed in package.json.",
          evidence: { hasConfigFile }
        });
      }
    },
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (LEFTHOOK_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default LefthookPlugin;
