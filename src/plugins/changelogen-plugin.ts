import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CHANGELOGEN_CONFIG_BASENAMES = [
  "changelog.config.json",
  "changelog.config.ts",
  "changelog.config.js",
  "changelog.config.mjs",
  "changelog.config.cjs",
  "changelog.config.mts",
  "changelog.config.cts",
  ".changelogrc",
];
const CHANGELOGEN_PACKAGE = "changelogen";

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function hasChangelogenDependency(packageJson: any): boolean {
  return [packageJson?.dependencies, packageJson?.devDependencies, packageJson?.peerDependencies]
    .some((section) => !!section?.[CHANGELOGEN_PACKAGE]);
}

function isChangelogenScript(script: string): boolean {
  return /(?:^|[\s&|;])changelogen(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?changelogen\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?changelogen\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?changelogen\b/.test(script);
}

function isChangelogenConfig(fileId: string): boolean {
  return CHANGELOGEN_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

/**
 * Changelogen is configured through c12 from the current directory. Its official
 * `changelog.config.*`, `.changelogrc`, and package.json#changelog inputs are
 * tool entry points and must be recognized independently of source imports.
 */
export const ChangelogenPlugin: AnalyzerPlugin = {
  name: "changelogen-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasChangelogenDependency(packageJson) || packageJson?.changelog) return true;

    for (const configFile of CHANGELOGEN_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(CHANGELOGEN_CONFIG_BASENAMES)).length > 0) return true;

    return Object.values(packageJson?.scripts ?? {}).some((script) => typeof script === "string" && isChangelogenScript(script));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const configFiles = await adapter.findFiles(CHANGELOGEN_CONFIG_BASENAMES);
      const hasInlineConfig = !!packageJson?.changelog;
      const dependencyDeclared = hasChangelogenDependency(packageJson);
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);
      if (hasInlineConfig) adapter.markAsUsed("package.json", "changelog");

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isChangelogenScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      if ((configFiles.length > 0 || hasInlineConfig || hasScriptInvocation) && dependencyDeclared) {
        adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE);
      }

      if ((configFiles.length > 0 || hasInlineConfig || hasScriptInvocation) && !dependencyDeclared) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Changelogen configuration or command found, but 'changelogen' is not listed in package.json.",
          evidence: { configFiles, hasInlineConfig, hasScriptInvocation },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isChangelogenConfig(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node) && (node.source.value === CHANGELOGEN_PACKAGE || node.source.value.startsWith("changelogen/"))) {
        adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE);
        adapter.markAsUsed(fileId);
      }
      if (isChangelogenConfig(fileId) && (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node))) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default ChangelogenPlugin;
