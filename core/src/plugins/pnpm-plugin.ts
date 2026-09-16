import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const PNPM_CONFIG_FILES = [
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".npmrc",
  "pnpmfile.js",
  ".pnpmfile.cjs",
];

export const PnpmPlugin: AnalyzerPlugin = {
  name: "pnpm-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check for standard configuration or lockfiles
    for (const configFile of PNPM_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json packageManager field or CLI scripts
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (typeof pkg.packageManager === "string" && pkg.packageManager.startsWith("pnpm")) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some((s) => typeof s === "string" && (s.includes("pnpm ") || s === "pnpm"))
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

      let hasDeclaredWorkspaces = false;

      // 1. Protect standalone configuration files & lockfiles
      for (const configFile of PNPM_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      // 2. Track npm scripts invoking pnpm CLI (e.g., "build": "pnpm -r build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("pnpm ") || scriptContent === "pnpm")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // 3. Parse pnpm-workspace.yaml to extract package glob patterns
      const workspaceContent = await adapter.readFile("pnpm-workspace.yaml");
      if (workspaceContent) {
        const lines = workspaceContent.split("\n");
        let capturingPackages = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("packages:")) {
            capturingPackages = true;
            continue;
          }

          if (capturingPackages) {
            if (trimmed.startsWith("-")) {
              let globPath = trimmed.replace(/^-/, "").trim();
              globPath = globPath.replace(/^['"]|['"]$/g, "");
              if (globPath) {
                hasDeclaredWorkspaces = true;
                adapter.setWorkspaceGlobs([globPath]);
                adapter.markAsUsed(globPath);
              }
            } else if (trimmed && !trimmed.startsWith("#")) {
              capturingPackages = false;
            }
          }
        }
      }

      // 4. Classify as a monorepo only when an actual workspace declaration was parsed.
      if (hasDeclaredWorkspaces) {
        adapter.setRepoType("monorepo");
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (PNPM_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      if (basename === "pnpmfile.js" || basename === ".pnpmfile.cjs") {
        // Handle ESM: export default { hooks: { readPackage } }
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

        // Handle CJS: module.exports = { ... }
        if (
          t.isAssignmentExpression(node) &&
          t.isMemberExpression(node.left) &&
          t.isIdentifier(node.left.object) &&
          node.left.object.name === "module" &&
          t.isIdentifier(node.left.property) &&
          node.left.property.name === "exports"
        ) {
          adapter.markAsUsed(fileId);
        }
      }
    },
  },
};

export default PnpmPlugin;
