import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CHANGELOGITHUB_CONFIG_BASENAMES = [
  "changelogithub.config.json",
  "changelogithub.config.ts",
  "changelogithub.config.js",
  "changelogithub.config.mjs",
  "changelogithub.config.cjs",
  "changelogithub.config.mts",
  "changelogithub.config.cts",
  ".changelogithubrc",
];
const CHANGELOGITHUB_PACKAGE = "changelogithub";

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function hasChangelogithubDependency(packageJson: any): boolean {
  return [packageJson?.dependencies, packageJson?.devDependencies, packageJson?.peerDependencies]
    .some((section) => !!section?.[CHANGELOGITHUB_PACKAGE]);
}

function isChangelogithubScript(script: string): boolean {
  return /(?:^|[\s&|;])changelogithub(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?changelogithub\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?changelogithub\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?changelogithub\b/.test(script);
}

function isChangelogithubConfig(fileId: string): boolean {
  return CHANGELOGITHUB_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

/**
 * Changelogithub uses the project-root configuration and package.json field
 * documented by the upstream project. These are release-tool entry points, so a
 * declared package is retained only when config, command, or import evidence exists.
 */
export const ChangelogithubPlugin: AnalyzerPlugin = {
  name: "changelogithub-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasChangelogithubDependency(packageJson) || !!packageJson?.changelogithub) return true;

    for (const configFile of CHANGELOGITHUB_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(CHANGELOGITHUB_CONFIG_BASENAMES)).length > 0) return true;

    return Object.values(packageJson?.scripts ?? {}).some((script) => typeof script === "string" && isChangelogithubScript(script));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const configFiles = await adapter.findFiles(CHANGELOGITHUB_CONFIG_BASENAMES);
      const hasInlineConfig = !!packageJson?.changelogithub;
      const dependencyDeclared = hasChangelogithubDependency(packageJson);
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);
      if (hasInlineConfig) adapter.markAsUsed("package.json", "changelogithub");

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isChangelogithubScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      if ((configFiles.length > 0 || hasInlineConfig || hasScriptInvocation) && dependencyDeclared) {
        adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE);
      }

      if ((configFiles.length > 0 || hasInlineConfig || hasScriptInvocation) && !dependencyDeclared) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Changelogithub configuration or command found, but 'changelogithub' is not listed in package.json.",
          evidence: { configFiles, hasInlineConfig, hasScriptInvocation },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isChangelogithubConfig(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node) && (node.source.value === CHANGELOGITHUB_PACKAGE || node.source.value.startsWith("changelogithub/"))) {
        adapter.markPackageAsUsed(CHANGELOGITHUB_PACKAGE);
        adapter.markAsUsed(fileId);
      }
      if (isChangelogithubConfig(fileId) && (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default ChangelogithubPlugin;
