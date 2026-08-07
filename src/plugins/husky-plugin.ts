import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

export const HuskyPlugin: AnalyzerPlugin = {
  name: "husky-plugin",
  version: "1.2.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["husky"] || pkg.dependencies?.["husky"])) {
      return true;
    }
    // Check for .husky directory files
    const hasHusky = (await adapter.readFile(".husky/pre-commit")) !== null;
    return hasHusky;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasHuskyDep = pkg ? !!(pkg.dependencies?.["husky"] || pkg.devDependencies?.["husky"]) : false;
      
      const hasHuskyDir = (await adapter.readFile(".husky/pre-commit")) !== null;
      if (hasHuskyDir && !hasHuskyDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Husky hooks found but 'husky' is not listed in package.json.",
          evidence: { hasHuskyDir }
        });
      }

      if (pkg?.scripts?.prepare?.includes("husky")) {
        adapter.markAsUsed("package.json", "scripts:prepare");
      }
    },
    onFileStart: (fileId, adapter) => {
      if (fileId.includes(".husky/")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default HuskyPlugin;
