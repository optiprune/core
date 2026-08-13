import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const LINTHTML_CONFIG_BASENAMES = [
  ".linthtmlrc",
  ".linthtmlrc.json",
  ".linthtmlrc.yaml",
  ".linthtmlrc.yml",
  "linthtml.config.js",
  "linthtml.config.cjs",
  "linthtml.config.mjs",
  "linthtml.config.ts",
  "linthtml.config.mts",
  "linthtml.config.cts",
  ".linthtmlignore",
];
const LINTHTML_PACKAGES = ["@linthtml/linthtml", "linthtml"];

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function isLintHtmlScript(script: string): boolean {
  return /(?:^|[\s&|;])linthtml(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?@linthtml\/linthtml\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?linthtml\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?linthtml\b/.test(script);
}

function declaredLintHtmlPackages(packageJson: any): string[] {
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
  } as Record<string, unknown>;
  return LINTHTML_PACKAGES.filter((packageName) => packageName in dependencies);
}

function isLintHtmlConfig(fileId: string): boolean {
  return LINTHTML_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

/**
 * LintHTML can be configured in standalone files or in package.json. Neither
 * pathway requires a normal source import, so it must explicitly carry package
 * usage evidence into the dependency analysis.
 */
export const LintHtmlPlugin: AnalyzerPlugin = {
  name: "linthtml-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (packageJson?.linthtml || declaredLintHtmlPackages(packageJson).length > 0) return true;

    for (const configFile of LINTHTML_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(LINTHTML_CONFIG_BASENAMES)).length > 0) return true;

    return Object.values(packageJson?.scripts ?? {}).some((script) => typeof script === "string" && isLintHtmlScript(script));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const packages = declaredLintHtmlPackages(packageJson);
      const configFiles = await adapter.findFiles(LINTHTML_CONFIG_BASENAMES);
      const hasInlineConfig = !!packageJson?.linthtml;
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);
      if (hasInlineConfig) adapter.markAsUsed("package.json", "linthtml");

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isLintHtmlScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      if ((configFiles.length > 0 || hasInlineConfig || hasScriptInvocation) && packages.length > 0) {
        for (const packageName of packages) adapter.markPackageAsUsed(packageName);
      }

      if ((configFiles.length > 0 || hasInlineConfig || hasScriptInvocation) && packages.length === 0) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "LintHTML configuration or command found, but '@linthtml/linthtml' is not listed in package.json.",
          evidence: { configFiles, hasInlineConfig, hasScriptInvocation },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isLintHtmlConfig(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node) && LINTHTML_PACKAGES.includes(node.source.value)) {
        adapter.markPackageAsUsed(node.source.value);
        adapter.markAsUsed(fileId);
      }

      const normalized = normalize(fileId);
      if (!isLintHtmlConfig(normalized)) return;
      if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");
      if (
        t.isAssignmentExpression(node)
        && t.isMemberExpression(node.left)
        && t.isIdentifier(node.left.object)
        && node.left.object.name === "module"
        && t.isIdentifier(node.left.property)
        && node.left.property.name === "exports"
      ) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default LintHtmlPlugin;
