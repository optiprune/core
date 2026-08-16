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

function extractRunCommands(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const commands: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const match = line.match(/^(\s*)(?:-\s*)?run:\s*(.*)$/);
    if (!match) continue;

    const indentation = (match[1] ?? "").length;
    const inline = (match[2] ?? "").trim();
    if (inline && inline !== "|" && inline !== ">") {
      commands.push(inline);
      continue;
    }

    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line === undefined) break;
      if (!line.trim()) {
        commands.push("");
        continue;
      }
      const nextIndentation = line.match(/^\s*/)?.[0].length ?? 0;
      if (nextIndentation <= indentation) break;
      commands.push(line.trim());
      index = next;
    }
  }

  return commands;
}

function commandTokens(command: string): string[] {
  return command.match(/"[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|[^\s]+/g)
    ?.map((token) => token.replace(/^['"]|['"]$/g, "")) ?? [];
}

async function markLocalScript(rawPath: string, adapter: any): Promise<void> {
  const value = rawPath.replace(/[;,]+$/, "");
  if (!value || value.startsWith("-") || value.startsWith("$")) return;
  if (!value.startsWith(".") && !value.startsWith("/") && !value.includes("/") && !/\.[cm]?[jt]sx?$/.test(value)) return;

  const rootDir = adapter.getConfig().rootDir;
  const absolute = path.isAbsolute(value) ? value : path.resolve(rootDir, value);
  const candidates = [
    absolute,
    `${absolute}.js`,
    `${absolute}.mjs`,
    `${absolute}.cjs`,
    `${absolute}.ts`,
    `${absolute}.tsx`,
    `${absolute}.jsx`,
    path.join(absolute, "index.js"),
    path.join(absolute, "index.ts"),
  ];

  for (const candidate of candidates) {
    const exists = await adapter.folderExists(candidate);
    if (exists) {
      adapter.markAsUsed(candidate);
      return;
    }
  }
}

async function markRunCommand(command: string, adapter: any): Promise<void> {
  const tokens = commandTokens(command);
  const firstToken = tokens[0];
  if (!firstToken || firstToken.startsWith("#")) return;

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token || (!/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token) && token !== "sudo" && token !== "command")) break;
    index += 1;
  }
  const executable = tokens[index]?.split("/").pop()?.toLowerCase();
  if (!executable) return;

  const packageJson = await adapter.readJson("package.json");
  const markPackageScript = (scriptName: string) => {
    if (typeof packageJson?.scripts?.[scriptName] === "string") {
      adapter.markAsUsed("package.json", `scripts:${scriptName}`);
    }
  };

  if (executable === "node" || executable === "nodejs") {
    for (const token of tokens.slice(index + 1)) {
      if (token === "-e" || token === "--eval" || token.startsWith("-")) continue;
      await markLocalScript(token, adapter);
      break;
    }
    return;
  }

  if (["npm", "pnpm", "yarn", "bun", "npx"].includes(executable)) {
    const args = tokens.slice(index + 1);
    const subcommand = args[0];
    if (subcommand === "run" || subcommand === "run-script") {
      if (args[1]) markPackageScript(args[1]);
      return;
    }
    if (subcommand === "exec" || executable === "npx") {
      const target = args.find((token) => !token.startsWith("-"));
      if (target) await markLocalScript(target, adapter);
      return;
    }
    if (args[0] && !args[0].startsWith("-")) markPackageScript(args[0]);
    return;
  }

  const directScript = tokens[index];
  if (directScript) await markLocalScript(directScript, adapter);
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
      const workflowFiles = new Set<string>([
        ...(await adapter.findFilesByGlob([".github/workflows/*.yml", ".github/workflows/*.yaml"])),
        ...(await adapter.findFiles(["action.yml", "action.yaml"])),
      ]);

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

        // 2. Treat every run: block as a shell script. This protects local
        // scripts and package.json scripts invoked through node/npm/pnpm/yarn.
        for (const command of extractRunCommands(content)) {
          await markRunCommand(command, adapter);
        }

        // 3. Extract package usages from package-manager commands in run: steps.
        const pmRegex = /(?:npm|pnpm|yarn|bun|npx)\s+(?:run\s+|exec\s+)?([@a-zA-Z0-9\-\/]+)/gi;
        while ((match = pmRegex.exec(content)) !== null) {
          const pkgName = match[1];
          if (pkgName && !pkgName.startsWith("-")) {
            adapter.markPackageAsUsed(pkgName);
          }
        }

        // 4. Dynamic Tool Setup Checking
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