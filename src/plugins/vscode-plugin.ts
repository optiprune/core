import { AnalyzerPlugin } from "../types.js";

const VSCODE_FILES = [
  ".vscode/settings.json",
  ".vscode/tasks.json",
  ".vscode/launch.json",
  ".vscode/extensions.json"
];

/**
 * Strips single-line (//) and multi-line (/* *\/) comments and trailing commas 
 * to parse VS Code's JSONC format cleanly.
 */
function parseJsonc<T = any>(content: string): T | null {
  try {
    const cleanJson = content
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

export const VsCodePlugin: AnalyzerPlugin = {
  name: "vscode-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    return await adapter.folderExists(".vscode");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      if (!(await adapter.folderExists(".vscode"))) return;

      // 1. Mark .vscode folder files as used entry points
      for (const file of VSCODE_FILES) {
        if (await adapter.folderExists(file)) {
          adapter.markAsUsed(file);
        }
      }

      // 2. Inspect .vscode/tasks.json for script and CLI tool usage
      const tasksContent = await adapter.readFile(".vscode/tasks.json");
      if (tasksContent) {
        const tasksJson = parseJsonc(tasksContent);
        if (tasksJson?.tasks && Array.isArray(tasksJson.tasks)) {
          for (const task of tasksJson.tasks) {
            const command = typeof task.command === "string" ? task.command : "";
            const args = Array.isArray(task.args) ? task.args.join(" ") : "";
            const fullCmd = `${command} ${args}`.trim();

            if (!fullCmd) continue;

            // Extract npm/pnpm/yarn/bun script executions (e.g., "npm run build", "pnpm test")
            const scriptMatch = /(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([a-zA-Z0-9\-_:]+)/i.exec(fullCmd);
            if (scriptMatch?.[1] && !["run", "exec", "dlx", "install"].includes(scriptMatch[1])) {
              adapter.markAsUsed("package.json", `scripts:${scriptMatch[1]}`);
            }

            // Extract CLI package executions (e.g., "npx tsc", "pnpm dlx vite")
            const cliMatch = /(?:npx|bunx|pnpm\s+dlx|yarn\s+dlx)\s+([@a-zA-Z0-9\-/]+)/i.exec(fullCmd);
            if (cliMatch?.[1] && !cliMatch[1].startsWith("-")) {
              adapter.markPackageAsUsed(cliMatch[1]);
            }
          }
        }
      }

      // 3. Inspect .vscode/launch.json for debug program entry points
      const launchContent = await adapter.readFile(".vscode/launch.json");
      if (launchContent) {
        const launchJson = parseJsonc(launchContent);
        if (launchJson?.configurations && Array.isArray(launchJson.configurations)) {
          for (const config of launchJson.configurations) {
            // Protect program entry points (e.g., "program": "${workspaceFolder}/src/index.ts")
            if (typeof config.program === "string") {
              const cleanPath = config.program.replace(/\$\{workspaceFolder\}/g, ".").replace(/^\.\//, "");
              adapter.markAsUsed(cleanPath);
            }

            // Protect custom runtime executables (e.g., "runtimeExecutable": "tsx" or "node")
            if (typeof config.runtimeExecutable === "string" && !["node", "npm", "pnpm", "yarn", "bun"].includes(config.runtimeExecutable)) {
              adapter.markPackageAsUsed(config.runtimeExecutable);
            }

            // Protect referenced env files (e.g., "envFile": "${workspaceFolder}/.env")
            if (typeof config.envFile === "string") {
              const cleanEnvPath = config.envFile.replace(/\$\{workspaceFolder\}/g, ".").replace(/^\.\//, "");
              adapter.markAsUsed(cleanEnvPath);
            }
          }
        }
      }

      // 4. Inspect .vscode/settings.json for workspace configurations
      const settingsContent = await adapter.readFile(".vscode/settings.json");
      if (settingsContent) {
        const settingsJson = parseJsonc(settingsContent);
        if (settingsJson) {
          // If custom TypeScript TSDK path is set
          if (typeof settingsJson["typescript.tsdk"] === "string") {
            adapter.markPackageAsUsed("typescript");
          }
          // If custom ESLint / Prettier config paths are set
          if (typeof settingsJson["prettier.configPath"] === "string") {
            adapter.markAsUsed(settingsJson["prettier.configPath"]);
            adapter.markPackageAsUsed("prettier");
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      if (normalized.includes(".vscode/")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default VsCodePlugin;