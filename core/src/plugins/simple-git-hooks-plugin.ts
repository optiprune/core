import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SIMPLE_GIT_HOOKS_CONFIG_FILES = [
  ".simple-git-hooks.json",
  ".simple-git-hooks.js",
  ".simple-git-hooks.cjs",
  ".simple-git-hooks.mjs",
  ".simple-git-hooks.yaml",
  ".simple-git-hooks.yml",
  "simple-git-hooks.json",
  "simple-git-hooks.js",
  "simple-git-hooks.cjs",
  "simple-git-hooks.mjs",
  "simple-git-hooks.yaml",
  "simple-git-hooks.yml",
];

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

export const SimpleGitHooksPlugin: AnalyzerPlugin = {
  name: "simple-git-hooks-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check package.json dependencies, simple-git-hooks field, or scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if ("simple-git-hooks" in allDeps || pkg["simple-git-hooks"]) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) =>
              typeof s === "string" &&
              (s.includes("simple-git-hooks ") || s === "simple-git-hooks"),
          )
        ) {
          return true;
        }
      }
    }

    // 2. Check for configuration files
    for (const configFile of SIMPLE_GIT_HOOKS_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasHookDep = "simple-git-hooks" in allDeps;

      // 1. Safeguard simple-git-hooks in package.json
      if (hasHookDep) {
        adapter.markPackageAsUsed("simple-git-hooks");
      }

      // 2. Protect standalone configuration files
      let hasConfigFile = false;
      for (const configFile of SIMPLE_GIT_HOOKS_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 3. Process package.json "simple-git-hooks" block if present
      let hookConfig: any = null;
      if (pkg?.["simple-git-hooks"]) {
        hasConfigFile = true;
        adapter.markAsUsed("package.json", "simple-git-hooks");
        hookConfig = pkg["simple-git-hooks"];
      }

      // 4. Track npm scripts invoking simple-git-hooks CLI (e.g. "prepare": "simple-git-hooks")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("simple-git-hooks ") || scriptContent === "simple-git-hooks")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("simple-git-hooks");
          }
        }
      }

      // 5. Inspect JSON-based config files (.simple-git-hooks.json) for hook commands
      if (!hookConfig) {
        for (const jsonConfigName of [".simple-git-hooks.json", "simple-git-hooks.json"]) {
          const content = await adapter.readFile(jsonConfigName);
          if (content) {
            const parsed = parseJsonc(content);
            if (parsed) {
              hookConfig = parsed;
              break;
            }
          }
        }
      }

      // 6. Inspect declared hooks and protect referenced tools & npm scripts
      if (hookConfig && typeof hookConfig === "object") {
        processHookCommands(hookConfig, adapter);
      }

      // 7. Report missing dependency if configuration exists without simple-git-hooks package
      if (hasConfigFile && !hasHookDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "simple-git-hooks configuration found, but 'simple-git-hooks' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.["simple-git-hooks"] },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect simple-git-hooks configuration files
      if (SIMPLE_GIT_HOOKS_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("simple-git-hooks");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SIMPLE_GIT_HOOKS_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for simple-git-hooks
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "simple-git-hooks") {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. In JavaScript configuration files (.simple-git-hooks.js / .simple-git-hooks.cjs)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("simple-git-hooks");
        }

        // CommonJS module.exports = { ... }
        if (
          node?.type === "AssignmentExpression" &&
          node.left?.type === "MemberExpression" &&
          node.left?.object?.name === "module" &&
          node.left?.property?.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("simple-git-hooks");
        }

        // Parse object properties representing git hooks (e.g. 'pre-commit': 'npx lint-staged')
        if (t.isObjectProperty(node) && t.isStringLiteral(node.value)) {
          parseHookCommandString(node.value.value, adapter);
        }
      }
    },
  },
};

function processHookCommands(configObj: Record<string, any>, adapter: any): void {
  for (const [hookName, command] of Object.entries(configObj)) {
    if (typeof command === "string") {
      parseHookCommandString(command, adapter);
    }
  }
}

function parseHookCommandString(commandStr: string, adapter: any): void {
  // Extract npx commands: "npx lint-staged" or "npx --no-install prettier"
  if (commandStr.includes("npx ")) {
    const parts = commandStr.split("npx ")[1]?.trim().split(" ");
    const pkgName = parts?.find((p) => !p.startsWith("-"));
    if (pkgName) {
      adapter.markPackageAsUsed(pkgName);
    }
  }

  // Extract npm run / yarn / pnpm script invocations: "npm run lint"
  if (commandStr.includes("npm run ") || commandStr.includes("pnpm run ")) {
    const scriptName = commandStr
      .split(/run\s+/)[1]
      ?.trim()
      .split(" ")[0];
    if (scriptName) {
      adapter.markAsUsed("package.json", `scripts:${scriptName}`);
    }
  }
}

export default SimpleGitHooksPlugin;
