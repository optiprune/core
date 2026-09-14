import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PAYLOAD_CONFIG_BASENAMES = [
  "payload.config.ts",
  "payload.config.tsx",
  "payload.config.js",
  "payload.config.mjs",
  "payload.config.cjs",
  "payload.config.mts",
  "payload.config.cts",
];
const PAYLOAD_PACKAGE = "payload";

function normalize(fileId: string): string {
  return fileId.replace(/\\/g, "/");
}

function isPayloadPackage(packageName: string): boolean {
  return packageName === PAYLOAD_PACKAGE || packageName.startsWith("@payloadcms/");
}

function declaredPayloadPackages(packageJson: any): string[] {
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies,
  } as Record<string, unknown>;
  return Object.keys(dependencies).filter(isPayloadPackage);
}

function isPayloadConfigFile(fileId: string): boolean {
  return PAYLOAD_CONFIG_BASENAMES.includes(path.basename(normalize(fileId)));
}

function isPayloadScript(script: string): boolean {
  return (
    /(?:^|[\s&|;])payload(?:\s|$)/.test(script) ||
    /\bnpx\s+(?:--yes\s+)?payload\b/.test(script) ||
    /\bpnpm\s+(?:exec\s+)?payload\b/.test(script) ||
    /\byarn\s+(?:dlx\s+)?payload\b/.test(script)
  );
}

/**
 * Payload's runtime begins from a config file, which is discovered by its CLI
 * from the project root, TypeScript root/out directories, and deployment output.
 * A configuration therefore proves use of the core package, but optional adapters
 * and plugins are retained only when their own import/config reference is observed.
 */
export const PayloadCMSPlugin: AnalyzerPlugin = {
  name: "payload-cms-plugin",
  version: "1.1.0",

  detect: async (adapter) => {
    const packageJson = await adapter.readJson("package.json");
    if (declaredPayloadPackages(packageJson).length > 0) return true;

    for (const configFile of PAYLOAD_CONFIG_BASENAMES) {
      if (await adapter.folderExists(configFile)) return true;
    }
    if ((await adapter.findFiles(PAYLOAD_CONFIG_BASENAMES)).length > 0) return true;

    return Object.values(packageJson?.scripts ?? {}).some(
      (script) => typeof script === "string" && isPayloadScript(script),
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const packageJson = await adapter.readJson("package.json");
      const packages = declaredPayloadPackages(packageJson);
      const configFiles = await adapter.findFiles(PAYLOAD_CONFIG_BASENAMES);
      const hasCorePackage = packages.includes(PAYLOAD_PACKAGE);
      let hasScriptInvocation = false;

      for (const configFile of configFiles) adapter.markAsUsed(configFile);

      for (const [scriptName, script] of Object.entries(packageJson?.scripts ?? {})) {
        if (typeof script !== "string" || !isPayloadScript(script)) continue;
        hasScriptInvocation = true;
        adapter.markAsUsed("package.json", `scripts:${scriptName}`);
      }

      // The Payload config is the required runtime input of the core `payload`
      // package. Do not mark every optional @payloadcms package merely because it
      // is declared; imports below identify those optional runtime integrations.
      if ((configFiles.length > 0 || hasScriptInvocation) && hasCorePackage) {
        adapter.markPackageAsUsed(PAYLOAD_PACKAGE);
      }

      if ((configFiles.length > 0 || hasScriptInvocation) && !hasCorePackage) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message:
            "Payload configuration or command found, but 'payload' is not listed in package.json.",
          evidence: { configFiles, hasScriptInvocation },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      if (isPayloadConfigFile(fileId)) adapter.markAsUsed(fileId);
    },

    onASTNode: (node, fileId, adapter) => {
      // Optional adapters, rich-text packages, plugins, and the Next integration
      // are commonly imported only by Payload config or generated route modules.
      if (t.isImportDeclaration(node) && isPayloadPackage(node.source.value)) {
        adapter.markPackageAsUsed(node.source.value);
        adapter.markAsUsed(fileId);
      }

      if (!isPayloadConfigFile(fileId)) return;
      if (t.isExportDefaultDeclaration(node)) adapter.markAsUsed(fileId, "default");

      // `buildConfig()` may be wrapped or aliased, so retaining the config module
      // itself is safer than inferring optional package use from callee names alone.
      if (
        t.isCallExpression(node) &&
        t.isIdentifier(node.callee) &&
        node.callee.name === "buildConfig"
      ) {
        adapter.markAsUsed(fileId);
      }
    },
  },
};

export default PayloadCMSPlugin;
