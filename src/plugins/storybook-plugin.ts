import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const STORY_FILE_REGEX = /\.(?:stories|story)\.[cm]?[jt]sx?$/i;
const STORYBOOK_CONFIG_BASENAMES = [
  "main.js", "main.jsx", "main.mjs", "main.cjs", "main.ts", "main.tsx", "main.mts", "main.cts",
  "preview.js", "preview.jsx", "preview.mjs", "preview.cjs", "preview.ts", "preview.tsx", "preview.mts", "preview.cts",
  "manager.js", "manager.jsx", "manager.mjs", "manager.cjs", "manager.ts", "manager.tsx", "manager.mts", "manager.cts",
  "test-runner.js", "test-runner.ts", "test-runner.mjs", "test-runner.cjs",
];

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function isStorybookPackage(packageName: string): boolean {
  return packageName === "storybook" || packageName.startsWith("@storybook/");
}

function isStorybookConfigFile(fileId: string): boolean {
  const normalized = normalize(fileId);
  const basename = path.basename(normalized);
  return (normalized.includes("/.storybook/") || normalized.startsWith(".storybook/"))
    && (STORYBOOK_CONFIG_BASENAMES.includes(basename) || normalized.includes("/.storybook/") || normalized.startsWith(".storybook/"));
}

function declaredStorybookPackages(packageJson: any): string[] {
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
  } as Record<string, unknown>;
  return Object.keys(dependencies).filter(isStorybookPackage);
}

function isStorybookScript(script: string): boolean {
  return /(?:^|[\s&|;])(?:storybook|build-storybook)(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?storybook\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?storybook\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?storybook\b/.test(script);
}

function propertyName(node: any): string | undefined {
  if (!t.isObjectProperty(node) || node.computed) return undefined;
  if (t.isIdentifier(node.key)) return node.key.name;
  return t.isStringLiteral(node.key) ? node.key.value : undefined;
}

function packageNameFromConfigValue(value: any): string | undefined {
  if (t.isStringLiteral(value) && isStorybookPackage(value.value)) return value.value;
  if (!t.isObjectExpression(value)) return undefined;
  for (const property of value.properties ?? []) {
    if (propertyName(property) === "name" && t.isStringLiteral(property.value) && isStorybookPackage(property.value.value)) {
      return property.value.value;
    }
  }
  return undefined;
}

function markConfiguredPackage(value: any, adapter: Parameters<NonNullable<AnalyzerPlugin["lifecycle"]["onASTNode"]>>[2]): void {
  const packageName = packageNameFromConfigValue(value);
  if (packageName) adapter.markPackageAsUsed(packageName);
}

/**
 * Storybook configurations are executable entry points rather than ordinary source files.
 * This plugin therefore treats a config as evidence for locally declared framework/addon
 * packages, while retaining only the CSF exports that Storybook consumes from story files.
 */
export const StorybookPlugin: AnalyzerPlugin = {
  name: "storybook-plugin",
  version: "1.3.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (declaredStorybookPackages(packageJson).length > 0) return true;
    if (await adapter.folderExists(".storybook")) return true;

    const configFiles = await adapter.findFiles(STORYBOOK_CONFIG_BASENAMES);
    return configFiles.some(isStorybookConfigFile);
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const packages = declaredStorybookPackages(packageJson);
      const configFiles = (await adapter.findFiles(STORYBOOK_CONFIG_BASENAMES)).filter(isStorybookConfigFile);
      const rootConfigDirectory = await adapter.folderExists(".storybook");
      const hasConfiguration = rootConfigDirectory || configFiles.length > 0;

      // Storybook's framework/addon graph is normally referenced only from main.ts.
      // A real config is consequently sufficient usage evidence for the declared set.
      if (hasConfiguration) {
        for (const packageName of packages) adapter.markPackageAsUsed(packageName);
      }

      if (rootConfigDirectory) adapter.markAsUsed(".storybook");
      for (const configFile of configFiles) adapter.markAsUsed(configFile);

      let hasScriptInvocation = false;
      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isStorybookScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      // A CLI invocation only establishes usage of the declared `storybook` package,
      // not every optional framework or addon.
      if (hasScriptInvocation && packages.includes("storybook")) {
        adapter.markPackageAsUsed("storybook");
      }

      if ((hasConfiguration || hasScriptInvocation) && packages.length === 0) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Storybook configuration or command found, but no 'storybook' or '@storybook/*' package is listed in package.json.",
          evidence: { configFiles, hasScriptInvocation },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = normalize(fileId);
      if (isStorybookConfigFile(normalized) || STORY_FILE_REGEX.test(normalized)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = normalize(fileId);
      const isConfig = isStorybookConfigFile(normalized);
      const isStory = STORY_FILE_REGEX.test(normalized);

      // Covers framework packages, portable CSF helpers, addon APIs, and advanced
      // `storybook/internal/*` imports that are invisible to script detection.
      if (t.isImportDeclaration(node) && isStorybookPackage(node.source.value)) {
        adapter.markPackageAsUsed(node.source.value);
        adapter.markAsUsed(fileId);
      }

      if (isConfig) {
        if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");

        // Framework accepts a package string or an object with a `name` package field.
        if (propertyName(node) === "framework") markConfiguredPackage(node.value, adapter);

        // Addons likewise accept package strings or descriptor objects. They are usually
        // only mentioned in main.ts, so this mark prevents false unused-dependency reports.
        if (propertyName(node) === "addons" && t.isArrayExpression(node.value)) {
          for (const addon of node.value.elements ?? []) markConfiguredPackage(addon, adapter);
        }
      }

      if (!isStory) return;

      // Component Story Format consumes default metadata plus named story exports,
      // even though application code does not directly import them.
      if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");
      if (!t.isExportNamedDeclaration(node) || !node.declaration) return;

      const declaration = node.declaration;
      if (t.isVariableDeclaration(declaration)) {
        for (const declarator of declaration.declarations ?? []) {
          if (t.isIdentifier(declarator.id)) adapter.markAsUsed(fileId, declarator.id.name);
        }
      } else if (t.isFunctionDeclaration(declaration) && declaration.id) {
        adapter.markAsUsed(fileId, declaration.id.name);
      } else if (t.isClassDeclaration(declaration) && declaration.id) {
        adapter.markAsUsed(fileId, declaration.id.name);
      }
    },
  },
};

export default StorybookPlugin;
