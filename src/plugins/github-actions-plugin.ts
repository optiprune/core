import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

export const GithubActionsPlugin: AnalyzerPlugin = {
  name: "github-actions-plugin",
  version: "1.2.0",
  detect: async (adapter) => {
    // Basic detection: look for workflows or action metadata
    const pkg = await adapter.readJson("package.json");
    if (pkg) return true; // Most JS projects might have actions
    
    const hasWorkflows = (await adapter.readFile(".github/workflows/main.yml")) !== null || 
                         (await adapter.readFile(".github/workflows/ci.yml")) !== null ||
                         (await adapter.readFile("action.yml")) !== null;
    return hasWorkflows;
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      // Find all workflow files
      const workflowFiles = [
        ".github/workflows/ci.yml",
        ".github/workflows/ci.yaml",
        ".github/workflows/release.yml",
        ".github/workflows/release.yaml",
        ".github/workflows/cr.yml",
        ".github/workflows/cr.yaml",
        "action.yml",
        "action.yaml"
      ];

      for (const fileId of workflowFiles) {
        const content = await adapter.readFile(fileId);
        if (content) {
          adapter.markAsUsed(fileId);

          // 1. Extract package usages from 'run' steps
          // Simple regex to find package names after package managers
          const pmRegex = /(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+|exec\s+)?([@a-z0-9\-\/]+)/gi;
          let match;
          while ((match = pmRegex.exec(content)) !== null) {
            const pkgName = match[1];
            if (pkgName && !pkgName.startsWith("-")) {
              adapter.markPackageAsUsed(pkgName);
            }
          }

          // 2. Extract usages from 'uses' actions
          const usesRegex = /uses:\s+([a-z0-9\-._\/]+)/gi;
          while ((match = usesRegex.exec(content)) !== null) {
            const action = match[1];
            if (action) {
              // Mark the action itself (though usually not in package.json)
              adapter.markPackageAsUsed(action);
            }
          }

          // 3. Check for missing setups (moved from onFileStart)
          if (content.includes("pnpm ") && !content.includes("pnpm/action-setup") && !content.includes("corepack enable pnpm")) {
            adapter.emitFinding({
              rule: "missing-ci-setup",
              severity: "error",
              confidence: "high",
              file: fileId,
              message: "Workflow uses 'pnpm' but no setup action (e.g., pnpm/action-setup) was found.",
              evidence: { tool: "pnpm" }
            });
          }
          if (content.includes("bun ") && !content.includes("oven-sh/setup-bun")) {
            adapter.emitFinding({
              rule: "missing-ci-setup",
              severity: "error",
              confidence: "high",
              file: fileId,
              message: "Workflow uses 'bun' but no setup action (e.g., oven-sh/setup-bun) was found.",
              evidence: { tool: "bun" }
            });
          }
        }
      }
    }
  }
};

export default GithubActionsPlugin;
