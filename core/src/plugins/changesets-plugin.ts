import { AnalyzerPlugin, PluginAdapter } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CHANGESET_DIRECTORY = ".changeset";
const CHANGESET_CONFIG_FILE = ".changeset/config.json";
const CHANGESET_PRE_FILE = ".changeset/pre.json";
const CHANGESET_README_FILE = ".changeset/README.md";
const CHANGESETS_CLI_PACKAGE = "@changesets/cli";

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

function hasChangesetsCli(packageJson: any): boolean {
  return [
    packageJson?.dependencies,
    packageJson?.devDependencies,
    packageJson?.peerDependencies,
    packageJson?.optionalDependencies,
  ].some((section) => !!section?.[CHANGESETS_CLI_PACKAGE]);
}

function isChangesetScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])changeset(?:\s|$)/.test(script) ||
    /\b(?:npx|pnpm|yarn|bunx)\s+(?:--yes\s+)?(?:@changesets\/cli|changeset)\b/.test(script) ||
    /\b(?:pnpm|yarn)\s+(?:exec|dlx)\s+(?:@changesets\/cli|changeset)\b/.test(script)
  );
}

function isGlobalOrTransientExecution(script: string): boolean {
  return (
    /\bnpx\s+(?:--yes\s+)?(?:@changesets\/cli|changeset)\b/.test(script) ||
    /\bpnpm\s+dlx\s+(?:@changesets\/cli|changeset)\b/.test(script) ||
    /\byarn\s+dlx\s+(?:@changesets\/cli|changeset)\b/.test(script) ||
    /\bbunx\s+(?:@changesets\/cli|changeset)\b/.test(script)
  );
}

function getChangelogEntry(config: Record<string, any>): string | undefined {
  const value = config.changelog;
  const candidate = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  return typeof candidate === "string" ? candidate : undefined;
}

export const ChangesetsPlugin: AnalyzerPlugin = {
  name: "changesets-plugin",
  version: "1.2.1",

  detect: async (adapter: PluginAdapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (hasChangesetsCli(packageJson)) return true;
    if (await adapter.folderExists(CHANGESET_DIRECTORY)) return true;

    const hasScript = Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isChangesetScript(script),
    );
    if (hasScript) return true;

    const workflows = await adapter.findFiles(WORKFLOW_PATTERNS);
    for (const workflow of workflows) {
      const raw = await readRawFile(adapter, workflow);
      if (
        raw.includes("changesets/action") ||
        raw.includes("@changesets/cli") ||
        raw.includes("changeset publish") ||
        raw.includes("changeset version")
      ) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter: PluginAdapter) => {
      const packageJson = await adapter.readJson("package.json");
      const hasDirectory = await adapter.folderExists(CHANGESET_DIRECTORY);
      const hasConfig = await adapter.folderExists(CHANGESET_CONFIG_FILE);
      const cliDeclared = hasChangesetsCli(packageJson);

      let hasScriptInvocation = false;
      let onlyTransientInvocation = true;

      // 1. Mark changesets root and known metadata files
      if (hasDirectory) adapter.markAsUsed(CHANGESET_DIRECTORY);
      if (hasConfig) adapter.markAsUsed(CHANGESET_CONFIG_FILE);
      if (await adapter.folderExists(CHANGESET_PRE_FILE)) adapter.markAsUsed(CHANGESET_PRE_FILE);
      if (await adapter.folderExists(CHANGESET_README_FILE))
        adapter.markAsUsed(CHANGESET_README_FILE);

      // 2. Discover and preserve markdown changeset entries
      const changesetEntries = await adapter.findFiles([".changeset/*.md", ".changeset/**/*.md"]);
      for (const entry of changesetEntries) {
        adapter.markAsUsed(entry);
      }

      // 3. Inspect package.json scripts
      const scripts = packageJson?.scripts ?? {};
      for (const [scriptName, script] of Object.entries(scripts)) {
        if (typeof script !== "string" || !isChangesetScript(script)) continue;

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
        if (
          raw.includes("changesets/action") ||
          raw.includes("@changesets/cli") ||
          raw.includes("changeset publish") ||
          raw.includes("changeset version")
        ) {
          hasWorkflowInvocation = true;
          adapter.markAsUsed(workflow);
        }
      }

      // 5. Inspect .changeset/config.json
      if (hasConfig) {
        try {
          const config = await adapter.readJson(CHANGESET_CONFIG_FILE);
          if (config && typeof config === "object") {
            const entry = getChangelogEntry(config);
            if (entry) {
              if (entry.startsWith(".") || entry.startsWith("/")) {
                const localChangelogPath = path.resolve(CHANGESET_DIRECTORY, entry);
                adapter.markAsUsed(localChangelogPath);
              } else {
                adapter.markPackageAsUsed(entry);
              }
            }
          }
        } catch {
          // Ignore malformed JSON
        }
      }

      const isUsedInProject =
        hasDirectory || hasConfig || hasScriptInvocation || hasWorkflowInvocation;

      // 6. Mark @changesets/cli if declared
      if (isUsedInProject && cliDeclared) {
        adapter.markPackageAsUsed(CHANGESETS_CLI_PACKAGE);
      }

      // 7. Check if local package is required
      const requiresLocalDep = hasConfig || (hasScriptInvocation && !onlyTransientInvocation);

      if (isUsedInProject && !cliDeclared && requiresLocalDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Changesets configuration or script found, but '@changesets/cli' is not listed in package.json.",
          evidence: { hasDirectory, hasConfig, hasScriptInvocation },
        });
      }
    },

    onFileStart: (fileId: string, adapter: PluginAdapter) => {
      const normalized = normalize(fileId);
      if (normalized.includes("/.changeset/") || normalized.startsWith(".changeset/")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: unknown, fileId: string, adapter: PluginAdapter) => {
      if (
        t.isImportDeclaration(node) &&
        (node.source.value === CHANGESETS_CLI_PACKAGE ||
          node.source.value.startsWith("@changesets/"))
      ) {
        adapter.markPackageAsUsed(node.source.value);
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default ChangesetsPlugin;
