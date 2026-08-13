import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const CYPRESS_CONFIG_BASENAMES = [
  "cypress.config.js",
  "cypress.config.ts",
  "cypress.config.mjs",
  "cypress.config.cjs",
  "cypress.config.mts",
  "cypress.config.cts",
  // Legacy Cypress configuration is retained for existing projects.
  "cypress.json",
];
const CYPRESS_PACKAGE = "cypress";
const NX_CYPRESS_PACKAGE = "@nx/cypress";

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function declaredCypressPackages(packageJson: any): string[] {
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
  } as Record<string, unknown>;
  return [CYPRESS_PACKAGE, NX_CYPRESS_PACKAGE].filter((packageName) => packageName in dependencies);
}

function isCypressScript(script: string): boolean {
  return /(?:^|[\s&|;])cypress(?:\s|$)/.test(script)
    || /\bnpx\s+(?:--yes\s+)?cypress\b/.test(script)
    || /\bpnpm\s+(?:exec\s+)?cypress\b/.test(script)
    || /\byarn\s+(?:dlx\s+)?cypress\b/.test(script);
}

function isCypressConfig(fileId: string): boolean {
  return CYPRESS_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

function isCypressTestFile(fileId: string): boolean {
  const normalized = normalize(fileId);
  return normalized.includes("/cypress/")
    || normalized.startsWith("cypress/")
    || /\.(?:cy|spec)\.[cm]?[jt]sx?$/.test(normalized);
}

/**
 * Cypress projects commonly have no source import from `cypress`: the CLI loads
 * a project config and test tree directly. Config and command evidence therefore
 * retain a declared Cypress package; an absent package produces a finding rather
 * than a fictitious usage mark.
 */
export const CypressPlugin: AnalyzerPlugin = {
  name: "cypress-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (declaredCypressPackages(packageJson).length > 0) return true;

    for (const configFile of CYPRESS_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(CYPRESS_CONFIG_BASENAMES)).length > 0) return true;
    if (await adapter.folderExists("cypress")) return true;

    return Object.values(packageJson?.scripts ?? {}).some((script) => typeof script === "string" && isCypressScript(script));
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const packages = declaredCypressPackages(packageJson);
      const configFiles = await adapter.findFiles(CYPRESS_CONFIG_BASENAMES);
      const hasTestDirectory = await adapter.folderExists("cypress");
      const isNxProject = await adapter.folderExists("nx.json");
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);
      if (hasTestDirectory) adapter.markAsUsed("cypress");

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isCypressScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      const hasProjectEvidence = configFiles.length > 0 || hasTestDirectory || hasScriptInvocation;
      if (hasProjectEvidence && packages.includes(CYPRESS_PACKAGE)) {
        adapter.markPackageAsUsed(CYPRESS_PACKAGE);
      }
      if (hasProjectEvidence && isNxProject && packages.includes(NX_CYPRESS_PACKAGE)) {
        adapter.markPackageAsUsed(NX_CYPRESS_PACKAGE);
      }

      if (hasProjectEvidence && packages.length === 0) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Cypress configuration, tests, or command found, but 'cypress' is not listed in package.json.",
          evidence: { configFiles, hasTestDirectory, hasScriptInvocation, isNxProject },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isCypressConfig(fileId) || isCypressTestFile(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      if (t.isImportDeclaration(node) && (node.source.value === CYPRESS_PACKAGE || node.source.value.startsWith("cypress/"))) {
        adapter.markPackageAsUsed(CYPRESS_PACKAGE);
        adapter.markAsUsed(fileId);
      }

      if (!isCypressConfig(fileId)) return;
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

export default CypressPlugin;
