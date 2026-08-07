import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

export const GithubActionsPlugin: AnalyzerPlugin = {
  name: "github-actions-plugin",
  version: "1.2.0",
  detect: async (adapter) => {
    // Basic detection: look for workflows or action metadata
    const hasWorkflows = (await adapter.readFile(".github/workflows/main.yml")) !== null || 
                         (await adapter.readFile(".github/workflows/ci.yml")) !== null ||
                         (await adapter.readFile("action.yml")) !== null;
    return hasWorkflows;
  },
  lifecycle: {
    onFileStart: async (fileId, adapter) => {
      const basename = path.basename(fileId);
      const isWorkflow = fileId.includes(".github/workflows/") && (basename.endsWith(".yml") || basename.endsWith(".yaml"));
      const isAction = basename === "action.yml" || basename === "action.yaml";

      if (isWorkflow || isAction) {
        adapter.markAsUsed(fileId);

        // Analyze workflow content for missing setups
        if (isWorkflow) {
          const content = await adapter.readFile(fileId);
          if (content) {
            // Check for pnpm usage
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

            // Check for bun usage
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

            // Check for yarn usage (though yarn is often pre-installed, it's good to check)
            if (content.includes("yarn ") && !content.includes("actions/setup-node") && !content.includes("corepack enable yarn")) {
               // Yarn is usually on the image, but specific versions might need setup
            }
            
            // Check for mismatch: project uses pnpm but workflow uses npm
            const pkg = await adapter.readJson("package.json");
            const usesPnpm = pkg?.packageManager?.startsWith("pnpm") || (await adapter.readFile("pnpm-lock.yaml")) !== null;
            if (usesPnpm && content.includes("npm install") && !content.includes("pnpm")) {
                adapter.emitFinding({
                    rule: "ci-mismatch",
                    severity: "warning",
                    confidence: "medium",
                    file: fileId,
                    message: "Project seems to use pnpm, but workflow uses 'npm install'.",
                    evidence: { expected: "pnpm", found: "npm" }
                });
            }
          }
        }
      }
    }
  }
};

export default GithubActionsPlugin;
