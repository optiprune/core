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
  version: "1.2.2",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["husky"] || pkg.dependencies?.["husky"])) {
      return true;
    }
    
    for (const hook of HUSKY_HOOKS) {
      if ((await adapter.readFile(`.husky/${hook}`)) !== null) return true;
    }
    
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

      // Mark husky as used so layer6 never flags it as unused or missing
      if (hasHuskyHooks || hasHuskyDep) {
        adapter.markAsUsed("package.json", "devDependencies:husky");
      }

      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("husky")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
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