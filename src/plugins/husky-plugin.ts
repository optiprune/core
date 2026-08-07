import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const HUSKY_HOOKS = [
  "pre-commit",
  "commit-msg",
  "pre-push",
  "post-checkout",
  "post-merge",
  "pre-rebase",
  "prepare-commit-msg",
  "post-commit",
  "post-rewrite",
  "sendemail-validate"
];

export const HuskyPlugin: AnalyzerPlugin = {
  name: "husky-plugin",
  version: "1.2.1",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["husky"] || pkg.dependencies?.["husky"])) {
      return true;
    }
    
    // Check for any common husky hook files
    for (const hook of HUSKY_HOOKS) {
      if ((await adapter.readFile(`.husky/${hook}`)) !== null) return true;
    }
    
    // Also check for legacy .huskyrc or husky.config.js
    if ((await adapter.readFile(".huskyrc")) !== null) return true;
    if ((await adapter.readFile("husky.config.js")) !== null) return true;
    
    return false;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const hasHuskyDep = pkg ? !!(pkg.dependencies?.["husky"] || pkg.devDependencies?.["husky"]) : false;
      
      let hasHuskyHooks = false;
      for (const hook of HUSKY_HOOKS) {
        if ((await adapter.readFile(`.husky/${hook}`)) !== null) {
          hasHuskyHooks = true;
          break;
        }
      }

      if (hasHuskyHooks && !hasHuskyDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Husky hooks found in .husky/ but 'husky' is not listed in package.json.",
          evidence: { hasHuskyHooks }
        });
      }

      // Mark husky-related scripts as used
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("husky")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }
    },
    onFileStart: (fileId, adapter) => {
      // Mark any file inside .husky directory as used to prevent unreachable-file warnings
      if (fileId.includes(".husky/")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default HuskyPlugin;
