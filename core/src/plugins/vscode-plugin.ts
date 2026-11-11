import { AnalyzerPlugin } from "../types.js";
import { fileExists, packageRoot, parsePluginJson } from "../plugin-utils.js";

const VSCODE_FILES = [
  ".vscode/settings.json",
  ".vscode/tasks.json",
  ".vscode/launch.json",
  ".vscode/extensions.json",
];

/**
 * Strips single-line (//) and multi-line (/* *\/) comments and trailing commas
 * to parse VS Code's JSONC format cleanly.
 */
function parseJsonc<T = any>(content: string): T | null {
  return parsePluginJson<T>(content);
}
function cleanWorkspacePath(value: string): string | null {
  const cleaned = value.replace(/\$\{workspaceFolder\}/g, ".").replace(/^\.\//, "");
  return cleaned.startsWith("../") || cleaned.startsWith("/") ? null : cleaned;
}
function runtimePackage(value: string): string | null {
  const cleaned = cleanWorkspacePath(value);
  if (!cleaned) return null;
  const normalized = cleaned.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const i = normalized.lastIndexOf(marker);
  if (i >= 0) return packageRoot(normalized.slice(i + marker.length).split("/")[0] ?? "");
  return normalized.includes("/") ? null : packageRoot(normalized);
}
function commandTokens(value: string): string[] {
  return (
    value.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g)?.map((x) => x.replace(/^(?:"|')|(?:"|')$/g, "")) ??
    []
  );
}
function markTaskCommand(command: string, adapter: any): void {
  const tokens = commandTokens(command);
  for (let i = 0; i < tokens.length; i++) {
    const tool = tokens[i];
    if (!tool) continue;
    let j = i + 1;
    if (["npm", "pnpm", "yarn", "bun"].includes(tool)) {
      while (j < tokens.length && tokens[j]?.startsWith("-")) j++;
      if (["run", "exec", "dlx"].includes(tokens[j] ?? "")) j++;
      while (j < tokens.length && tokens[j]?.startsWith("-")) j++;
      if (tokens[j] && !["install", "add"].includes(tokens[j] ?? "")) {
        adapter.markAsUsed("package.json", `scripts:${tokens[j]}`);
        return;
      }
    }
    if (
      ["npx", "bunx"].includes(tool) ||
      ((tool === "pnpm" || tool === "yarn") && tokens[i + 1] === "dlx")
    ) {
      j = tool === "pnpm" || tool === "yarn" ? i + 2 : i + 1;
      while (j < tokens.length && (tokens[j]?.startsWith("-") || tokens[j - 1] === "-p")) j++;
      if (tokens[j]) adapter.markPackageAsUsed(packageRoot(tokens[j] ?? ""));
      return;
    }
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
        if (await fileExists(adapter, file)) {
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
            markTaskCommand(fullCmd, adapter);
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
              const cleanPath = cleanWorkspacePath(config.program);
              if (cleanPath) adapter.markRelativeFileAsUsed(".vscode/launch.json", cleanPath);
            }

            // Protect custom runtime executables (e.g., "runtimeExecutable": "tsx" or "node")
            if (
              typeof config.runtimeExecutable === "string" &&
              !["node", "npm", "pnpm", "yarn", "bun"].includes(config.runtimeExecutable)
            ) {
              const runtime = runtimePackage(config.runtimeExecutable);
              if (runtime) adapter.markPackageAsUsed(runtime);
            }

            // Protect referenced env files (e.g., "envFile": "${workspaceFolder}/.env")
            if (typeof config.envFile === "string") {
              const cleanEnvPath = cleanWorkspacePath(config.envFile);
              if (cleanEnvPath) adapter.markRelativeFileAsUsed(".vscode/launch.json", cleanEnvPath);
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
            const configPath = cleanWorkspacePath(settingsJson["prettier.configPath"]);
            if (configPath) adapter.markRelativeFileAsUsed(".vscode/settings.json", configPath);
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
    },
  },
};

export default VsCodePlugin;
