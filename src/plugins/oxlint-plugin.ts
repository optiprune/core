import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import { loadStaticPluginConfig, stringArray } from "../plugin-config.js";
import path from "pathe";

const OXLINT_CONFIG_BASENAMES = [
  ".oxlintrc.json",
  ".oxlintrc.jsonc",
  "oxlint.config.ts",
  "oxlint.config.mts",
];
const OXLINT_PACKAGE = "oxlint";

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function directoryOf(fileId: string): string {
  const normalized = normalize(fileId);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

function hasOxlintDependency(packageJson: any): boolean {
  return [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
  ].some((section) => !!section?.[OXLINT_PACKAGE]);
}

function isOxlintScript(script: string): boolean {
  return /(?:^|[\s&|;])oxlint(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?oxlint\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?oxlint\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?oxlint\b/.test(script);
}

function referencedOptionPaths(script: string, option: string, shortOption?: string): string[] {
  const alternatives = [option, shortOption].filter((value): value is string => !!value)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (alternatives.length === 0) return [];
  const matcher = new RegExp(`(?:${alternatives.join("|")})(?:=|\\s+)([^\\s]+)`, "g");
  const paths: string[] = [];
  for (const match of script.matchAll(matcher)) {
    const value = match[1]?.replace(/^['"]|['"]$/g, "");
    if (value) paths.push(value);
  }
  return paths;
}

function resolveConfigReference(configFile: string, reference: string): string | undefined {
  if (!reference || reference.startsWith("@")) return undefined;
  const directory = directoryOf(configFile);
  const resolved = path.normalize(path.join(directory || ".", reference)).replace(/\\/g, "/");
  return resolved.startsWith("..") ? undefined : resolved;
}

/**
 * OXLint automatically discovers a known configuration filename in every
 * directory. Those configs and command-line invocations are real usage evidence
 * even when no application module imports `oxlint`, which fixes config-only
 * projects previously being reported as unused.
 */
export const OxlintPlugin: AnalyzerPlugin = {
  name: "oxlint-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasOxlintDependency(packageJson)) return true;

    for (const config of OXLINT_CONFIG_BASENAMES) {
      if (await adapter.folderExists(config)) return true;
    }

    if ((await adapter.findFiles(OXLINT_CONFIG_BASENAMES)).length > 0) return true;
    return Object.values(packageJson?.scripts ?? {}).some((script) => typeof script === "string" && isOxlintScript(script));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const configFiles = await adapter.findFiles(OXLINT_CONFIG_BASENAMES);
      const dependencyDeclared = hasOxlintDependency(packageJson);
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isOxlintScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);

        // Explicit config, tsconfig and ignore files are all tool inputs that
        // cannot reliably be discovered via source imports.
        for (const configPath of referencedOptionPaths(script, "--config", "-c")) {
          adapter.markAsUsed(configPath);
        }
        for (const tsconfigPath of referencedOptionPaths(script, "--tsconfig")) {
          adapter.markAsUsed(tsconfigPath);
        }
        for (const ignorePath of referencedOptionPaths(script, "--ignore-path")) {
          adapter.markAsUsed(ignorePath);
        }
      }

      if ((configFiles.length > 0 || hasScriptInvocation) && dependencyDeclared) {
        adapter.markPackageAsUsed(OXLINT_PACKAGE);
      }

      if ((configFiles.length > 0 || hasScriptInvocation) && !dependencyDeclared) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "OXLint configuration or command found, but 'oxlint' is not listed in package.json.",
          evidence: { configFiles, hasScriptInvocation },
        });
      }

      // JSON configurations can expose local extended config files. The static
      // loader intentionally avoids evaluating TypeScript configuration code.
      for (const configFile of configFiles) {
        const loaded = await loadStaticPluginConfig(adapter, [configFile]);
        if (!loaded) continue;
        for (const extension of stringArray(loaded.config.extends)) {
          const resolved = resolveConfigReference(configFile, extension);
          if (resolved) adapter.markAsUsed(resolved);
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      if (OXLINT_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)))) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node) && node.source.value === OXLINT_PACKAGE) {
        adapter.markPackageAsUsed(OXLINT_PACKAGE);
        adapter.markAsUsed(fileId);
      }

      const normalized = normalize(fileId);
      if (!OXLINT_CONFIG_BASENAMES.includes(path.basename(normalized))) return;
      if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");
    },
  },
};

export default OxlintPlugin;
