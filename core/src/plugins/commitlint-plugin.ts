import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const COMMITLINT_CLI_PACKAGE = "@commitlint/cli";

const COMMITLINT_CONFIG_FILES = [
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.yaml",
  ".commitlintrc.yml",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  ".commitlintrc.ts",
  ".commitlintrc.cts",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  "commitlint.config.ts",
  "commitlint.config.cts",
];

const HOOK_PATTERNS = [
  ".husky/*",
  ".husky/_/*",
  ".lefthook.yml",
  "lefthook.yml",
  ".simple-git-hooks.json",
  ".simple-git-hooks.js",
];

const WORKFLOW_PATTERNS = [".github/workflows/*.{yml,yaml}", ".github/workflows/**/*.{yml,yaml}"];

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

async function readRawFile(adapter: PluginAdapter, fileId: string): Promise<string> {
  try {
    if (typeof (adapter as any).readFile === "function") {
      const res = await (adapter as any).readFile(fileId);
      return typeof res === "string" ? res : "";
    }
    if (typeof (adapter as any).readText === "function") {
      const res = await (adapter as any).readText(fileId);
      return typeof res === "string" ? res : "";
    }
    const content = await adapter.readJson(fileId);
    return typeof content === "string" ? content : JSON.stringify(content);
  } catch {
    return "";
  }
}

function resolveCommitlintPreset(name: string): { type: "package" | "file"; pathOrName: string } {
  if (name.startsWith(".") || name.startsWith("/")) {
    return { type: "file", pathOrName: name };
  }
  if (name.startsWith("@")) {
    if (name.includes("/")) {
      return { type: "package", pathOrName: name };
    }
    return { type: "package", pathOrName: `${name}/commitlint-config` };
  }
  if (name.startsWith("commitlint-config-")) {
    return { type: "package", pathOrName: name };
  }
  return { type: "package", pathOrName: `@commitlint/config-${name}` };
}

function resolveCommitlintPlugin(name: string): string {
  if (name.startsWith("@")) return name;
  if (name.startsWith("commitlint-plugin-")) return name;
  return `commitlint-plugin-${name}`;
}

function isCommitlintInvocation(content: string): boolean {
  return (
    /(?:^|[\s&|;])commitlint(?:\s|$)/.test(content) ||
    /\b(?:npx|pnpm|yarn|bunx)\s+(?:--yes\s+)?commitlint\b/.test(content) ||
    /\b(?:pnpm|yarn)\s+(?:exec|dlx)\s+commitlint\b/.test(content)
  );
}

function isGlobalOrTransientExecution(content: string): boolean {
  return (
    /\bnpx\s+(?:--yes\s+)?commitlint\b/.test(content) ||
    /\bpnpm\s+dlx\s+commitlint\b/.test(content) ||
    /\byarn\s+dlx\s+commitlint\b/.test(content) ||
    /\bbunx\s+commitlint\b/.test(content)
  );
}

export const CommitlintPlugin: AnalyzerPlugin = {
  name: "commitlint-plugin",
  version: "1.2.1",

  detect: async (adapter: PluginAdapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
        ...pkg.optionalDependencies,
      };

      if (Object.keys(allDeps).some((p) => p === "commitlint" || p.startsWith("@commitlint/"))) {
        return true;
      }

      if (pkg.commitlint) return true;

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (scriptValues.some((s) => typeof s === "string" && isCommitlintInvocation(s))) {
          return true;
        }
      }
    }

    for (const configFile of COMMITLINT_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    const hookFiles = await adapter.findFiles(HOOK_PATTERNS);
    for (const hookFile of hookFiles) {
      const raw = await readRawFile(adapter, hookFile);
      if (raw && isCommitlintInvocation(raw)) return true;
    }

    const workflowFiles = await adapter.findFiles(WORKFLOW_PATTERNS);
    for (const workflow of workflowFiles) {
      const raw = await readRawFile(adapter, workflow);
      if (raw.includes("commitlint") || raw.includes("commitlint-github-action")) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter: PluginAdapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
        ...pkg?.optionalDependencies,
      };

      const hasDeclaredCommitlint = Object.keys(allDeps).some(
        (p) => p === "commitlint" || p === COMMITLINT_CLI_PACKAGE,
      );

      let hasConfigFile = false;
      let hasScriptInvocation = false;
      let hasHookInvocation = false;
      let hasWorkflowInvocation = false;
      let onlyTransientInvocation = true;

      // 1. Standalone configuration files
      for (const configFile of COMMITLINT_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Inline package.json configuration
      if (pkg?.commitlint) {
        adapter.markAsUsed("package.json", "commitlint");

        const extendsList = Array.isArray(pkg.commitlint.extends)
          ? pkg.commitlint.extends
          : typeof pkg.commitlint.extends === "string"
            ? [pkg.commitlint.extends]
            : [];

        for (const ext of extendsList) {
          if (typeof ext !== "string") continue;
          const resolved = resolveCommitlintPreset(ext);
          if (resolved.type === "package") {
            adapter.markPackageAsUsed(resolved.pathOrName);
          } else {
            adapter.markAsUsed(resolved.pathOrName);
          }
        }
      }

      // 3. package.json scripts
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && isCommitlintInvocation(scriptContent)) {
            hasScriptInvocation = true;
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);

            if (!isGlobalOrTransientExecution(scriptContent)) {
              onlyTransientInvocation = false;
            }
          }
        }
      }

      // 4. Git hook configurations
      const hookFiles = await adapter.findFiles(HOOK_PATTERNS);
      for (const hookFile of hookFiles) {
        const raw = await readRawFile(adapter, hookFile);
        if (isCommitlintInvocation(raw)) {
          hasHookInvocation = true;
          adapter.markAsUsed(hookFile);
          if (!isGlobalOrTransientExecution(raw)) {
            onlyTransientInvocation = false;
          }
        }
      }

      // 5. GitHub Actions workflows
      const workflowFiles = await adapter.findFiles(WORKFLOW_PATTERNS);
      for (const workflow of workflowFiles) {
        const raw = await readRawFile(adapter, workflow);
        if (raw.includes("commitlint") || raw.includes("commitlint-github-action")) {
          hasWorkflowInvocation = true;
          adapter.markAsUsed(workflow);
        }
      }

      const isUsedInProject =
        hasConfigFile ||
        !!pkg?.commitlint ||
        hasScriptInvocation ||
        hasHookInvocation ||
        hasWorkflowInvocation;

      // 6. Mark @commitlint/cli if declared and used
      if (isUsedInProject && hasDeclaredCommitlint) {
        adapter.markPackageAsUsed(COMMITLINT_CLI_PACKAGE);
        if (allDeps["commitlint"]) {
          adapter.markPackageAsUsed("commitlint");
        }
      }

      // 7. Emit missing-dependency
      const requiresLocalDep =
        hasConfigFile || hasHookInvocation || (hasScriptInvocation && !onlyTransientInvocation);

      if (isUsedInProject && !hasDeclaredCommitlint && requiresLocalDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Commitlint configuration or hook found, but '@commitlint/cli' is not listed in package.json.",
          evidence: { hasConfigFile, hasPkgBlock: !!pkg?.commitlint, hasHookInvocation },
        });
      }
    },

    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      const normalized = normalize(fileId);
      const basename = path.basename(normalized);

      if (COMMITLINT_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: unknown, fileId: string, adapter: PluginAdapter) => {
      const normalized = normalize(fileId);
      const basename = path.basename(normalized);
      const isConfigFile = COMMITLINT_CONFIG_FILES.includes(basename);

      // Detect ESM imports
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "commitlint" || source.startsWith("@commitlint/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }

      // Detect CJS require calls
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "require"
      ) {
        const arg = node.arguments[0];
        if (
          t.isStringLiteral(arg) &&
          (arg.value === "commitlint" || arg.value.startsWith("@commitlint/"))
        ) {
          adapter.markPackageAsUsed(arg.value);
          adapter.markAsUsed(fileId);
        }
      }

      // Inspect Commitlint configuration AST
      if (isConfigFile) {
        // ESM exports
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
        }

        // CJS module.exports = ... OR module["exports"] = ...
        if (t.isAssignmentExpression(node) && t.isMemberExpression(node.left)) {
          const isModule = t.isIdentifier(node.left.object) && node.left.object.name === "module";
          const isExports =
            (t.isIdentifier(node.left.property) && node.left.property.name === "exports") ||
            (t.isStringLiteral(node.left.property) && node.left.property.value === "exports");

          if (isModule && isExports) {
            adapter.markAsUsed(fileId);
          }
        }

        if (t.isObjectProperty(node)) {
          const isExtendsKey =
            (t.isIdentifier(node.key) && node.key.name === "extends") ||
            (t.isStringLiteral(node.key) && node.key.value === "extends");

          if (isExtendsKey) {
            const processExtendItem = (value: string) => {
              const resolved = resolveCommitlintPreset(value);
              if (resolved.type === "package") {
                adapter.markPackageAsUsed(resolved.pathOrName);
              } else {
                const localPath = path.resolve(path.dirname(fileId), resolved.pathOrName);
                adapter.markAsUsed(localPath);
              }
            };

            if (t.isArrayExpression(node.value)) {
              for (const el of node.value.elements) {
                if (t.isStringLiteral(el)) {
                  processExtendItem(el.value);
                }
              }
            } else if (t.isStringLiteral(node.value)) {
              processExtendItem(node.value.value);
            }
          }

          const isPluginsKey =
            (t.isIdentifier(node.key) && node.key.name === "plugins") ||
            (t.isStringLiteral(node.key) && node.key.value === "plugins");

          if (isPluginsKey && t.isArrayExpression(node.value)) {
            for (const el of node.value.elements) {
              if (t.isStringLiteral(el)) {
                const pluginPkg = resolveCommitlintPlugin(el.value);
                adapter.markPackageAsUsed(pluginPkg);
              }
            }
          }
        }
      }
    },
  },
};

export default CommitlintPlugin;
