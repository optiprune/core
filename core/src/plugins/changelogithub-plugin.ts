import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CHANGELOGITHUB_PACKAGE = "changelogithub";

const CHANGELOGITHUB_CONFIG_PATTERNS = [
  "changelogithub.config.{js,mjs,cjs,ts,mts,cts,json}",
  ".changelogithubrc.{js,mjs,cjs,ts,mts,cts,json}",
  ".changelogithubrc",
  ".config/changelogithub.{js,mjs,cjs,ts,mts,cts,json}",
];

const CHANGELOGITHUB_CONFIG_BASENAMES = new Set([
  "changelogithub.config.json",
  "changelogithub.config.ts",
  "changelogithub.config.js",
  "changelogithub.config.mjs",
  "changelogithub.config.cjs",
  "changelogithub.config.mts",
  "changelogithub.config.cts",
  ".changelogithubrc",
  ".changelogithubrc.json",
  ".changelogithubrc.ts",
  ".changelogithubrc.js",
  ".changelogithubrc.mjs",
  ".changelogithubrc.cjs",
]);

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

function hasChangelogithubDependency(packageJson: any): boolean {
  return [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
    packageJson?.optionalDependencies,
  ].some((section) => !!section?.[CHANGELOGITHUB_PACKAGE]);
}

function isChangelogithubScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])changelogithub(?:\s|$)/.test(script) ||
    /\b(?:npx|pnpm|yarn|bunx)\s+(?:--yes\s+)?changelogithub\b/.test(script) ||
    /\b(?:pnpm|yarn)\s+(?:exec|dlx)\s+changelogithub\b/.test(script)
  );
}

function isGlobalOrTransientExecution(script: string): boolean {
  return (
    /\bnpx\s+(?:--yes\s+)?changelogithub\b/.test(script) ||
    /\bpnpm\s+dlx\s+changelogithub\b/.test(script) ||
    /\byarn\s+dlx\s+changelogithub\b/.test(script) ||
    /\bbunx\s+changelogithub\b/.test(script)
  );
}

function isChangelogithubConfigFile(fileId: string): boolean {
  const base = path.basename(normalize(fileId));
  return CHANGELOGITHUB_CONFIG_BASENAMES.has(base);
}

export const ChangelogithubPlugin: AnalyzerPlugin = {
  name: "changelogithub-plugin",
  version: "1.2.1",

  detect: async (adapter: PluginAdapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasChangelogithubDependency(packageJson) || !!packageJson?.changelogithub) {
      return true;
    }

    const configs = await adapter.findFiles(CHANGELOGITHUB_CONFIG_PATTERNS);
    if (configs.length > 0) return true;

    const hasScript = Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isChangelogithubScript(script),
    );
    if (hasScript) return true;

    const workflows = await adapter.findFiles(WORKFLOW_PATTERNS);
    for (const workflow of workflows) {
      const raw = await readRawFile(adapter, workflow);
      if (raw.includes("changelogithub") || raw.includes("antfu/changelogithub")) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter: PluginAdapter) => {
      const packageJson = await adapter.readJson("package.json");
      const configFiles = await adapter.findFiles(CHANGELOGITHUB_CONFIG_PATTERNS);
      const hasInlineConfig = !!packageJson?.changelogithub;
      const dependencyDeclared = hasChangelogithubDependency(packageJson);

      let hasScriptInvocation = false;
      let onlyTransientInvocation = true;

      // 1. Mark config files
      for (const configFile of configFiles) {
        adapter.markAsUsed(configFile);
      }

      // 2. Mark package.json inline config
      if (hasInlineConfig) {
        adapter.markAsUsed("package.json", "changelogithub");
      }

      // 3. Inspect package.json scripts
      const scripts = packageJson?.scripts ?? {};
      for (const [scriptName, script] of Object.entries(scripts)) {
        if (typeof script !== "string" || !isChangelogithubScript(script)) continue;

        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);

        if (!isGlobalOrTransientExecution(script)) {
          onlyTransientInvocation = false;
        }
      }

      // 4. Inspect GitHub workflows
      let hasWorkflowInvocation = false;
      const workflows = await adapter.findFiles(WORKFLOW_PATTERNS);
      for (const workflow of workflows) {
        const raw = await readRawFile(adapter, workflow);
        if (raw.includes("changelogithub") || raw.includes("antfu/changelogithub")) {
          hasWorkflowInvocation = true;
          adapter.markAsUsed(workflow);
        }
      }

      const isUsedInProject =
        configFiles.length > 0 || hasInlineConfig || hasScriptInvocation || hasWorkflowInvocation;

      // 5. Mark dependency if declared
      if (isUsedInProject && dependencyDeclared) {
        adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE);
      }

      // 6. Report missing dependency if local script relies on it without transient runner
      const requiresLocalDep = hasScriptInvocation && !onlyTransientInvocation;
      if (isUsedInProject && !dependencyDeclared && requiresLocalDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Changelogithub script found, but 'changelogithub' is not listed in package.json.",
          evidence: {
            configFiles,
            hasInlineConfig,
            hasScriptInvocation,
          },
        });
      }
    },

    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      if (isChangelogithubConfigFile(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: unknown, fileId: string, adapter: PluginAdapter) => {
      if (
        t.isImportDeclaration(node) &&
        (node.source.value === CHANGELOGITHUB_PACKAGE ||
          node.source.value.startsWith(`${CHANGELOGITHUB_PACKAGE}/`))
      ) {
        adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE);
        adapter.markAsUsed(fileId);
      }

      if (
        isChangelogithubConfigFile(fileId) &&
        (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node))
      ) {
        adapter.markAsUsed(fileId);
      }

      if (isChangelogithubConfigFile(fileId) && t.isObjectProperty(node)) {
        const isTargetProp =
          (t.isIdentifier(node.key) &&
            (node.key.name === "template" || node.key.name === "output")) ||
          (t.isStringLiteral(node.key) &&
            (node.key.value === "template" || node.key.value === "output"));

        if (isTargetProp && t.isStringLiteral(node.value)) {
          const targetPath = path.resolve(path.dirname(fileId), node.value.value);
          adapter.markAsUsed(targetPath);
        }
      }
    },
  },
};

export default ChangelogithubPlugin;
