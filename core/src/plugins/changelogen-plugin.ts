import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CHANGELOGEN_PACKAGE = "changelogen";

// changelogen uses c12 under the hood with "changelog" as name
const CHANGELOGEN_CONFIG_PATTERNS = [
  "changelog.config.{js,mjs,cjs,ts,mts,cts,json}",
  ".changelogrc.{js,mjs,cjs,ts,mts,cts,json}",
  ".changelogrc",
  ".config/changelog.{js,mjs,cjs,ts,mts,cts,json}",
];

const CHANGELOGEN_CONFIG_BASENAMES = new Set([
  "changelog.config.json",
  "changelog.config.ts",
  "changelog.config.js",
  "changelog.config.mjs",
  "changelog.config.cjs",
  "changelog.config.mts",
  "changelog.config.cts",
  ".changelogrc",
  ".changelogrc.json",
  ".changelogrc.ts",
  ".changelogrc.js",
  ".changelogrc.mjs",
  ".changelogrc.cjs",
]);

// Companion files and conventional outputs generated or managed by changelogen
const CHANGELOGEN_ASSETS = ["CHANGELOG.md"];

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function hasChangelogenDependency(packageJson: any): boolean {
  return [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
    packageJson?.optionalDependencies,
  ].some((section) => !!section?.[CHANGELOGEN_PACKAGE]);
}

function isChangelogenScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])changelogen(?:\s|$)/.test(script) ||
    /\b(?:npx|pnpm|yarn|bunx)\s+(?:--yes\s+)?changelogen\b/.test(script) ||
    /\b(?:pnpm|yarn)\s+(?:exec|dlx)\s+changelogen\b/.test(script)
  );
}

function isGlobalOrTransientExecution(script: string): boolean {
  return (
    /\bnpx\s+(?:--yes\s+)?changelogen\b/.test(script) ||
    /\bpnpm\s+dlx\s+changelogen\b/.test(script) ||
    /\byarn\s+dlx\s+changelogen\b/.test(script) ||
    /\bbunx\s+changelogen\b/.test(script)
  );
}

function isChangelogenConfigFile(fileId: string): boolean {
  const base = path.basename(normalize(fileId));
  return CHANGELOGEN_CONFIG_BASENAMES.has(base);
}

export const ChangelogenPlugin: AnalyzerPlugin = {
  name: "changelogen-plugin",
  version: "1.2.0",

  detect: async (adapter: PluginAdapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasChangelogenDependency(packageJson) || !!packageJson?.changelog) {
      return true;
    }

    const configs = await adapter.findFiles(CHANGELOGEN_CONFIG_PATTERNS);
    if (configs.length > 0) return true;

    return Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isChangelogenScript(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter: PluginAdapter) => {
      const packageJson = await adapter.readJson("package.json");
      const configFiles = await adapter.findFiles(CHANGELOGEN_CONFIG_PATTERNS);
      const hasInlineConfig = !!packageJson?.changelog;
      const dependencyDeclared = hasChangelogenDependency(packageJson);

      let hasScriptInvocation = false;
      let onlyTransientInvocation = true;

      // 1. Mark discovered config files as project entry points
      for (const configFile of configFiles) {
        adapter.markAsUsed(configFile);
      }

      // 2. Mark companion files like CHANGELOG.md as intentional outputs
      for (const asset of CHANGELOGEN_ASSETS) {
        if (await adapter.folderExists(asset)) {
          adapter.markAsUsed(asset);
        }
      }

      // 3. Mark inline package.json configuration
      if (hasInlineConfig) {
        adapter.markAsUsed("package.json", "changelog");
      }

      // 4. Analyze package.json scripts
      const scripts = packageJson?.scripts ?? {};
      for (const [scriptName, script] of Object.entries(scripts)) {
        if (typeof script !== "string" || !isChangelogenScript(script)) continue;

        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);

        if (!isGlobalOrTransientExecution(script)) {
          onlyTransientInvocation = false;
        }
      }

      const isUsedInProject = configFiles.length > 0 || hasInlineConfig || hasScriptInvocation;

      // 5. Mark the dependency if declared
      if (isUsedInProject && dependencyDeclared) {
        adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE);
      }

      // 6. Report missing dependency ONLY if it's not run transiently
      if (
        isUsedInProject &&
        !dependencyDeclared &&
        (!hasScriptInvocation || !onlyTransientInvocation)
      ) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Changelogen configuration or local script found, but 'changelogen' is not listed in package.json.",
          evidence: {
            configFiles,
            hasInlineConfig,
            hasScriptInvocation,
          },
        });
      }
    },

    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      if (isChangelogenConfigFile(fileId)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: unknown, fileId: string, adapter: PluginAdapter) => {
      if (
        t.isImportDeclaration(node) &&
        (node.source.value === CHANGELOGEN_PACKAGE ||
          node.source.value.startsWith(`${CHANGELOGEN_PACKAGE}/`))
      ) {
        adapter.markPackageAsUsed(CHANGELOGEN_PACKAGE);
        adapter.markAsUsed(fileId);
      }

      if (
        isChangelogenConfigFile(fileId) &&
        (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node))
      ) {
        adapter.markAsUsed(fileId);
      }

      if (isChangelogenConfigFile(fileId) && t.isObjectProperty(node)) {
        const isTemplateKey =
          (t.isIdentifier(node.key) && node.key.name === "template") ||
          (t.isStringLiteral(node.key) && node.key.value === "template");

        if (isTemplateKey && t.isStringLiteral(node.value)) {
          const templatePath = path.resolve(path.dirname(fileId), node.value.value);
          adapter.markAsUsed(templatePath);
        }
      }
    },
  },
};

export default ChangelogenPlugin;
