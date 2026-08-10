import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

/**
 * Mapping of CLI tools to their common setup action signatures, corepack equivalents, or global installation patterns.
 */
interface ToolSetupConfig {
  name: string;
  // Action patterns matched in `uses:` (e.g. "pnpm/action-setup", "oven-sh/setup-bun")
  actions: string[];
  // Commands or flags in `run:` steps that implicitly set up or enable the tool
  setupCommands?: string[];
}

const KNOWN_CLI_TOOLS: Record<string, ToolSetupConfig> = {
  pnpm: {
    name: "pnpm",
    actions: ["pnpm/action-setup", "setup-pnpm"],
    setupCommands: ["corepack enable pnpm", "corepack enable", "npm i -g pnpm", "npm install -g pnpm"]
  },
  bun: {
    name: "bun",
    actions: ["oven-sh/setup-bun", "setup-bun"],
    setupCommands: ["npm i -g bun", "npm install -g bun", "curl -fsSL https://bun.sh/install"]
  },
  yarn: {
    name: "yarn",
    actions: ["setup-yarn", "actions/setup-node"],
    setupCommands: ["corepack enable yarn", "corepack enable", "npm i -g yarn", "npm install -g yarn"]
  },
  deno: {
    name: "deno",
    actions: ["denoland/setup-deno", "setup-deno"]
  },
  cargo: {
    name: "cargo",
    actions: ["actions-rs/toolchain", "dtolnay/rust-toolchain"]
  },
  go: {
    name: "go",
    actions: ["actions/setup-go"]
  },
  python: {
    name: "python",
    actions: ["actions/setup-python"]
  },
  poetry: {
    name: "poetry",
    actions: ["snok/install-poetry"]
  }
};

export const GithubActionsPlugin: AnalyzerPlugin = {
  name: "github-actions-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    // Check for workflow directory or local action definition files
    return (
      (await adapter.folderExists(".github/workflows")) ||
      (await adapter.folderExists("action.yml")) ||
      (await adapter.folderExists("action.yaml"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const workflowFiles = [
        ".github/workflows/ci.yml",
        ".github/workflows/ci.yaml",
        ".github/workflows/release.yml",
        ".github/workflows/release.yaml",
        ".github/workflows/cr.yml",
        ".github/workflows/cr.yaml",
        ".github/workflows/main.yml",
        ".github/workflows/main.yaml",
        "action.yml",
        "action.yaml"
      ];

      for (const fileId of workflowFiles) {
        const content = await adapter.readFile(fileId);
        if (!content) continue;

        adapter.markAsUsed(fileId);

        // 1. Extract used actions from 'uses:' steps
        const usedActions: string[] = [];
        const usesRegex = /uses:\s+([a-zA-Z0-9\-._\/]+)/gi;
        let match: RegExpExecArray | null;

        while ((match = usesRegex.exec(content)) !== null) {
          const action = match[1];
          if (action) {
            usedActions.push(action.toLowerCase());
            adapter.markPackageAsUsed(action);
          }
        }

        // 2. Extract package usages from 'run:' steps
        const pmRegex = /(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+|exec\s+)?([@a-zA-Z0-9\-\/]+)/gi;
        while ((match = pmRegex.exec(content)) !== null) {
          const pkgName = match[1];
          if (pkgName && !pkgName.startsWith("-")) {
            adapter.markPackageAsUsed(pkgName);
          }
        }

        // 3. Dynamic Tool Setup Checking
        for (const [tool, config] of Object.entries(KNOWN_CLI_TOOLS)) {
          // Check if tool command is invoked in any run step (e.g. "pnpm ", "pnpm\n", "bun ")
          const toolRegex = new RegExp(`(?:^|\\s|\\/)${tool}(?:\\s|$)`, "m");
          const isToolUsed = toolRegex.test(content);

          if (!isToolUsed) continue;

          // Verify if the tool is set up via an action
          const hasSetupAction = config.actions.some((actionPattern) =>
            usedActions.some((action) => action.includes(actionPattern.toLowerCase()))
          );

          // Verify if the tool is set up via a setup command in `run:`
          const hasSetupCommand = config.setupCommands?.some((cmd) =>
            content.toLowerCase().includes(cmd.toLowerCase())
          ) ?? false;

          // If used but not setup via action or setup command -> emit finding
          if (!hasSetupAction && !hasSetupCommand) {
            adapter.emitFinding({
              rule: "missing-ci-setup",
              severity: "error",
              confidence: "high",
              file: fileId,
              message: `Workflow invokes '${config.name}' CLI tool, but no setup action (or inline installation command) was detected.`,
              evidence: {
                tool: config.name,
                expectedActions: config.actions
              }
            });
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      if (normalized.includes(".github/workflows/") || normalized.endsWith("action.yml") || normalized.endsWith("action.yaml")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default GithubActionsPlugin;