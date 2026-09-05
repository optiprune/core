import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const YARN_CONFIG_FILES = ["yarn.lock", ".yarnrc", ".yarnrc.yml", ".yarnrc.yaml"];

const YARN_SPECIAL_DIRS = [".yarn/plugins", ".yarn/releases", ".yarn/sdks", ".yarn/versions"];

export const YarnPlugin: AnalyzerPlugin = {
  name: "yarn-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    // 1. Check for Yarn configuration files or lockfile
    for (const configFile of YARN_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check for Yarn Berry directories (.yarn/plugins, .yarn/releases)
    for (const dir of YARN_SPECIAL_DIRS) {
      if (await adapter.folderExists(dir)) return true;
    }

    // 3. Check package.json packageManager field ("packageManager": "yarn@4.0.0") or "workspaces"
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      if (typeof pkg.packageManager === "string" && pkg.packageManager.startsWith("yarn")) {
        return true;
      }

      if (pkg.workspaces) {
        return true;
      }

      if (pkg.scripts) {
        const scriptValues = Object.values(pkg.scripts);
        if (
          scriptValues.some((s) => typeof s === "string" && (s.includes("yarn ") || s === "yarn"))
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

      const hasYarnConfig =
        (await adapter.folderExists("yarn.lock")) ||
        (await adapter.folderExists(".yarnrc.yml")) ||
        (await adapter.folderExists(".yarnrc"));

      // 1. Protect standalone configuration files & lockfiles
      for (const configFile of YARN_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 2. Protect Yarn Berry directories
      for (const dir of YARN_SPECIAL_DIRS) {
        if (await adapter.folderExists(dir)) {
          adapter.markAsUsed(dir);
        }
      }

      // 3. Track npm scripts invoking Yarn CLI
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("yarn ") || scriptContent === "yarn")
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // 4. Parse package.json "workspaces" declaration for monorepos
      if (pkg?.workspaces) {
        adapter.markAsUsed("package.json", "workspaces");

        let workspaceGlobs: string[] = [];

        if (Array.isArray(pkg.workspaces)) {
          workspaceGlobs = pkg.workspaces.filter(
            (item: unknown): item is string => typeof item === "string",
          );
        } else if (
          typeof pkg.workspaces === "object" &&
          pkg.workspaces !== null &&
          Array.isArray((pkg.workspaces as { packages?: unknown[] }).packages)
        ) {
          workspaceGlobs = (pkg.workspaces as { packages: unknown[] }).packages.filter(
            (item: unknown): item is string => typeof item === "string",
          );
        }

        if (workspaceGlobs.length > 0) {
          adapter.setWorkspaceGlobs(workspaceGlobs);
          adapter.setRepoType("monorepo");

          workspaceGlobs.forEach((globPath) => {
            adapter.markAsUsed(globPath);
          });
        }
      } else if (hasYarnConfig) {
        adapter.setRepoType("single-package");
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect Yarn configuration files and lockfiles
      if (YARN_CONFIG_FILES.includes(basename)) {
        adapter.markConfigFileAsUsed(fileId);
      }

      // Protect Yarn Berry internal files (.yarn/plugins/**, .yarn/sdks/**)
      if (normalized.includes("/.yarn/") || normalized.startsWith(".yarn/")) {
        adapter.markAsUsed(fileId);
      }
    },

    onASTNode: (node: any, fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // In Yarn local plugin definitions (e.g., inside .yarn/plugins/)
      if (normalized.includes("/.yarn/plugins/")) {
        if (t.isExportDefaultDeclaration(node)) {
          adapter.markAsUsed(fileId, "default");
        }

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

export default YarnPlugin;
