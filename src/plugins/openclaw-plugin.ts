import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

/**
 * Recognized OpenClaw configuration and manifest files
 */
const OPENCLAW_CONFIG_FILES = [
  "openclaw.config.ts",
  "openclaw.config.js",
  "openclaw.config.mjs",
  "openclaw.config.cjs",
  "openclaw.json",
  "claw.config.ts",
  "claw.config.js",
  "claw.json",
];

const OPENCLAW_PACKAGES = [
  "openclaw",
  "@openclaw/core",
  "@openclaw/agent",
  "@openclaw/tools",
  "@openclaw/browser",
  "@openclaw/cli",
  "@openclaw/sdk",
];

const OPENCLAW_EXPORTS = new Set([
  "defineAgent",
  "defineTool",
  "defineWorkflow",
  "createAgent",
  "createTool",
  "runAgent",
]);

/**
 * Helper to check if a source path resides in OpenClaw's conventions
 */
function isOpenClawDirectory(normalizedPath: string): boolean {
  return (
    normalizedPath.includes("/agents/") ||
    normalizedPath.startsWith("agents/") ||
    normalizedPath.includes("/src/agents/") ||
    normalizedPath.startsWith("src/agents/") ||
    normalizedPath.includes("/tools/") ||
    normalizedPath.startsWith("tools/") ||
    normalizedPath.includes("/src/tools/") ||
    normalizedPath.startsWith("src/tools/") ||
    normalizedPath.includes("/workflows/") ||
    normalizedPath.startsWith("workflows/")
  );
}

export const OpenClawPlugin: AnalyzerPlugin = {
  name: "openclaw-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for dedicated OpenClaw config files
    for (const configFile of OPENCLAW_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check for agents, tools, or workflows folders
    if (
      (await adapter.folderExists("src/agents")) ||
      (await adapter.folderExists("agents")) ||
      (await adapter.folderExists("src/tools")) ||
      (await adapter.folderExists("tools"))
    ) {
      return true;
    }

    // 3. Check package.json for openclaw dependencies or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      };

      if (Object.keys(allDeps).some((dep) => dep === "openclaw" || dep.startsWith("@openclaw/"))) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some(
            (s) => typeof s === "string" && (/\bopenclaw\b/.test(s) || s.includes("claw run")),
          )
        ) {
          return true;
        }
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");

      // 1. Protect dedicated OpenClaw configuration files
      for (const configFile of OPENCLAW_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Protect agent and tool directory entries
      const agentFolders = [
        "src/agents",
        "agents",
        "src/tools",
        "tools",
        "src/workflows",
        "workflows",
      ];
      for (const folder of agentFolders) {
        if (await adapter.folderExists(folder)) {
          adapter.markAsUsed(folder);
        }
      }

      if (pkg) {
        // 3. Protect openclaw and all @openclaw/* packages in package.json
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
          ...pkg.peerDependencies,
        };

        for (const depName of Object.keys(allDeps)) {
          if (depName === "openclaw" || depName.startsWith("@openclaw/")) {
            // A manifest entry alone is not evidence that this package is used.
            // Usage is marked by the config, script, import, or file hooks below.
          }
        }

        // 4. Mark npm scripts calling openclaw or claw CLI as used
        if (pkg.scripts) {
          for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
            if (
              typeof scriptContent === "string" &&
              (/\bopenclaw\b/.test(scriptContent) ||
                /\bclaw\b/.test(scriptContent) ||
                scriptContent.includes("openclaw start"))
            ) {
              adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect config files
      if (OPENCLAW_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("openclaw");
      }

      // Protect agent, tool, and workflow definitions
      if (isOpenClawDirectory(normalized)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("openclaw");
      }
    },

    onASTNode: (node: any, fileId: string, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // 1. Inspect config files
      if (OPENCLAW_CONFIG_FILES.includes(basename)) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("openclaw");
        }
      }

      // 2. Detect defineAgent({ ... }), defineTool({ ... }), or createAgent(...) call expressions
      if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
        if (OPENCLAW_EXPORTS.has(node.callee.name)) {
          adapter.markAsUsed(fileId);
          adapter.markPackageAsUsed("openclaw");
        }
      }

      // 3. Protect agent/tool named or default exports
      if (isOpenClawDirectory(normalized)) {
        if (t.isExportDefaultDeclaration(node) || t.isExportNamedDeclaration(node)) {
          adapter.markAsUsed(fileId);
        }
      }

      // 4. Retain imports from openclaw or @openclaw/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "openclaw" || source.startsWith("@openclaw/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default OpenClawPlugin;
