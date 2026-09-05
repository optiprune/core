import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NITRO_CONFIG_FILES = [
  "nitro.config.ts",
  "nitro.config.js",
  "nitro.config.mjs",
  "nitro.config.cjs",
  "nitro.config.json",
];

const NITRO_PACKAGES = ["nitropack", "h3"];

export const NitroPlugin: AnalyzerPlugin = {
  name: "nitro-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (NITRO_PACKAGES.some((pkgName) => pkgName in allDeps)) {
        return true;
      }
    }

    for (const configFile of NITRO_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return await adapter.folderExists("server");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies,
      };

      const hasNitroDep = NITRO_PACKAGES.some((p) => p in allDeps);

      let hasConfigFile = false;
      for (const configFile of NITRO_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasConfigFile = true;
          adapter.markConfigFileAsUsed(configFile);
          break;
        }
      }

      // Safeguard nitropack and h3 packages in package.json
      // Package manifest presence alone is not usage evidence;
      // config, script, import, and file hooks provide the usage marks.

      // Track npm scripts invoking Nitro CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("nitro ") || scriptContent.includes("nitropack"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      if (hasConfigFile && !hasNitroDep) {
        adapter.emitFinding({
          rule: "missing-dependency",
          severity: "error",
          confidence: "high",
          file: "package.json",
          message: "Nitro configuration found but 'nitropack' is not listed in package.json.",
          evidence: { hasConfigFile },
        });
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Mark configuration files
      if (NITRO_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
        adapter.markPackageAsUsed("nitropack");
      }

      // 2. Protect Nitro server file conventions & auto-imports
      const nitroServerDirectories = [
        "server/api/",
        "server/routes/",
        "server/middleware/",
        "server/plugins/",
        "server/utils/",
        "server/tasks/",
        "server/database/",
      ];

      if (nitroServerDirectories.some((dir) => normalized.includes(dir))) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("nitropack");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);
      const isConfigFile = NITRO_CONFIG_FILES.includes(basename);

      // 1. Detect default exports in nitro.config.*
      if (isConfigFile && t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
        adapter.markPackageAsUsed("nitropack");
      }

      // 2. Detect default exports in server route / api handlers
      if (normalized.includes("server/") && t.isExportDefaultDeclaration(node)) {
        adapter.markAsUsed(fileId, "default");
      }

      // 3. Protect Nitro / H3 auto-imported event handlers (defineEventHandler, defineNitroPlugin, etc.)
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        const funcName = node.callee.name;
        if (
          [
            "defineEventHandler",
            "defineNitroPlugin",
            "defineRenderHandler",
            "defineTask",
            "eventHandler",
            "lazyEventHandler",
          ].includes(funcName)
        ) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("nitropack");
        }
      }
    },
  },
};

export default NitroPlugin;
