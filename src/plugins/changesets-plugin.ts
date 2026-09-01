import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";

const CHANGESET_DIRECTORY = ".changeset";
const CHANGESET_CONFIG_FILE = ".changeset/config.json";
const CHANGESETS_CLI_PACKAGE = "@changesets/cli";

function hasChangesetsCli(packageJson: any): boolean {
  return [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
  ].some((section) => !!section?.[CHANGESETS_CLI_PACKAGE]);
}

function isChangesetScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])changeset(?:\s|$)/.test(script) ||
    /\bnpx\s+(?:--yes\s+)?changeset\b/.test(script) ||
    /\bpnpm\s+(?:exec\s+)?changeset\b/.test(script) ||
    /\byarn\s+(?:dlx\s+)?changeset\b/.test(script)
  );
}

function changelogPackage(config: Record<string, any>): string | undefined {
  const value = config.changelog;
  const candidate = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  return typeof candidate === "string" && !candidate.startsWith(".") && !candidate.startsWith("/")
    ? candidate
    : undefined;
}

/**
 * Changesets uses `.changeset/config.json` plus markdown files as release inputs.
 * The config's `ignore`, `fixed`, and `linked` fields name workspace packages, not
 * package-manager dependencies; only the CLI and explicitly configured changelog
 * module may be retained as external packages.
 */
export const ChangesetsPlugin: AnalyzerPlugin = {
  name: "changesets-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasChangesetsCli(packageJson)) return true;
    if (await adapter.folderExists(CHANGESET_DIRECTORY)) return true;

    return Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isChangesetScript(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const hasDirectory = await adapter.folderExists(CHANGESET_DIRECTORY);
      const hasConfig = await adapter.folderExists(CHANGESET_CONFIG_FILE);
      const cliDeclared = hasChangesetsCli(packageJson);
      let hasScriptInvocation = false;

      if (hasDirectory) adapter.markAsUsed(CHANGESET_DIRECTORY);
      if (hasConfig) adapter.markAsUsed(CHANGESET_CONFIG_FILE);

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isChangesetScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      if (hasScriptInvocation && cliDeclared) {
        adapter.markPackageAsUsed(CHANGESETS_CLI_PACKAGE);
      }

      if ((hasDirectory || hasConfig || hasScriptInvocation) && !cliDeclared) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Changesets configuration or command found, but '@changesets/cli' is not listed in package.json.",
          evidence: { hasDirectory, hasConfig, hasScriptInvocation },
        });
      }

      if (!hasConfig) return;
      const config = await adapter.readJson(CHANGESET_CONFIG_FILE);
      if (!config || typeof config !== "object") return;
      if (typeof (config as Record<string, unknown>).$schema === "string") {
        const schema = (config as Record<string, unknown>).$schema as string;
        if (schema.includes("@changesets/config")) adapter.markPackageAsUsed("@changesets/config");
      }

      const configuredChangelog = changelogPackage(config);
      if (configuredChangelog) {
        adapter.markPackageAsUsed(configuredChangelog);
        const declared = Object.prototype.hasOwnProperty.call(
          {
            ...packageJson?.dependencies,
            ...packageJson?.devDependencies,
            ...packageJson?.peerDependencies,
          },
          configuredChangelog,
        );
        if (!declared) {
          adapter.emitFinding({
            rule: "missing-dependency",
            severity: "error",
            confidence: "high",
            file: CHANGESET_CONFIG_FILE,
            message: `Changesets changelog '${configuredChangelog}' is not listed in package.json.`,
            evidence: { package: configuredChangelog, importingFiles: [CHANGESET_CONFIG_FILE] },
          });
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      if (normalized.includes("/.changeset/") || normalized.startsWith(".changeset/")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node, fileId, adapter) => {
      if (!t.isImportDeclaration(node) || !node.source.value.startsWith("@changesets/")) return;
      adapter.markPackageAsUsed(node.source.value);
      adapter.markAsUsed(fileId);
    },
  },
};

export default ChangesetsPlugin;
