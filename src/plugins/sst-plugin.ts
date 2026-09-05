import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const SST_CONFIG_FILES = [
  "sst.config.ts",
  "sst.config.js",
  "sst.config.mts",
  "sst.config.mjs",
  "sst.config.cts",
  "sst.config.cjs",
  "sst-env.d.ts",
];

const SST_PACKAGES = ["sst", "aws-cdk-lib", "constructs", "@aws-cdk/core", "@sst-ion/aws"];

const SST_INFRA_PATTERNS = ["/stacks/", "/infra/", "stacks/", "infra/"];

export const SstPlugin: AnalyzerPlugin = {
  name: "sst-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => dep === "sst" || dep.startsWith("@sst-ion/"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some((s) => typeof s === "string" && (s.includes("sst ") || s === "sst"))
        ) {
          return true;
        }
      }
    }

    for (const configFile of SST_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("stacks")) ||
      (await adapter.folderExists("infra")) ||
      (await adapter.folderExists(".sst"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasSst = Object.keys(allDeps).some((p) => p === "sst" || p.startsWith("@sst-ion/"));

      // 1. Safeguard installed SST ecosystem packages in package.json
      if (hasSst) {
        for (const depName of Object.keys(allDeps)) {
          if (
            depName === "sst" ||
            depName.startsWith("@sst-ion/") ||
            depName === "aws-cdk-lib" ||
            depName === "constructs"
          ) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }
      }

      // 2. Protect standalone config files and infrastructure directories
      let hasConfigFile = false;
      for (const configFile of SST_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      if (await adapter.folderExists("stacks")) {
        adapter.markAsUsed("stacks");
      }

      if (await adapter.folderExists("infra")) {
        adapter.markAsUsed("infra");
      }

      // 3. Track npm scripts invoking SST CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("sst ") || scriptContent === "sst")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("sst");
          }
        }
      }

      // 4. Report missing dependency if SST config or infra folders exist without sst package
      if (hasConfigFile && !hasSst) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "SST configuration found, but 'sst' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect SST configuration and auto-generated env declaration files
      if (SST_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("sst");
      }

      // Protect infrastructure stacks or components defined in stacks/ or infra/
      if (SST_INFRA_PATTERNS.some((pattern) => normalized.includes(pattern))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("sst");
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = SST_CONFIG_FILES.includes(basename);

      // 1. Detect ESM imports for sst or SST constructs
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (
          source === "sst" ||
          source.startsWith("sst/") ||
          source.startsWith("@sst-ion/") ||
          source === "aws-cdk-lib"
        ) {
          adapter.markPackageAsUsed(source.split("/")[0] ?? source);
          adapter.markAsUsed(fileId);
        }
      }

      // 2. Detect SST v3 Resource Bindings: Resource.MyBucket.name or Resource.MyApi.url
      if (
        t.isMemberExpression(node) &&
        t.isIdentifier(node.object) &&
        node.object.name === "Resource" &&
        t.isIdentifier(node.property)
      ) {
        adapter.markAsUsed(fileId, node.property.name);
        adapter.markPackageAsUsed("sst");
      }

      // 3. In SST configuration files (sst.config.ts)
      if (isConfigFile) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
          adapter.markPackageAsUsed("sst");
        }

        // Detect $config({...}) call expression (SST v3 / Ion)
        if (
          t.isCallExpression(node) &&
          t.isIdentifier(node.callee) &&
          node.callee.name === "$config"
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("sst");
        }
      }
    },
  },
};

export default SstPlugin;
