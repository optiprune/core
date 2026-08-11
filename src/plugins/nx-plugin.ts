import { AnalyzerPlugin } from "../types.js";
import { t } from "../ast-utils.js";
import path from "pathe";

const NX_CONFIG_FILES = ["nx.json", "workspace.json"];

const NX_PACKAGES = [
  "nx",
  "@nx/devkit",
  "@nx/js",
  "@nx/react",
  "@nx/vue",
  "@nx/angular",
  "@nx/next",
  "@nx/nest",
  "@nx/vite",
  "@nx/webpack",
  "@nx/jest",
  "@nx/cypress",
  "@nx/playwright",
  "@nx/eslint",
  "@nx/storybook"
];

function parseJsonc<T = any>(content: string): T | null {
  try {
    const cleanJson = content
      .replace(/\/\/.*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/,(\s*[\]}])/g, "$1");
    return JSON.parse(cleanJson);
  } catch {
    return null;
  }
}

export const NxPlugin: AnalyzerPlugin = {
  name: "nx-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (NX_PACKAGES.some((p) => p in allDeps)) return true;
    }

    for (const configFile of NX_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists("project.json")) ||
      (await adapter.folderExists(".nx"))
    );
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      const allDeps = {
        ...pkg?.dependencies,
        ...pkg?.devDependencies,
        ...pkg?.peerDependencies
      };

      const hasNxDep = NX_PACKAGES.some((p) => p in allDeps);

      let hasNxConfig = false;
      // 1. Protect nx.json and workspace.json
      for (const configFile of NX_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          hasNxConfig = true;
          adapter.markAsUsed(configFile);
        }
      }

      if (hasNxConfig && !hasNxDep) {
        adapter.markPackageAsUsed("nx");
      }

      // 2. Protect installed Nx packages
      if (hasNxDep) {
        for (const nxPkg of NX_PACKAGES) {
          if (allDeps[nxPkg]) {
            adapter.markPackageAsUsed(nxPkg);
          }
        }
      }

      // 3. Inspect package.json scripts for Nx CLI usage (e.g. "build": "nx build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("nx ")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
            adapter.markPackageAsUsed("nx");
          }
        }
      }

      // 4. Parse nx.json for targetDefaults and plugin configurations
      const nxJsonContent = await adapter.readFile("nx.json");
      if (nxJsonContent) {
        const nxJson = parseJsonc(nxJsonContent);

        // Protect Nx plugins specified in nx.json (e.g. plugins: ["@nx/vite/plugin"])
        if (Array.isArray(nxJson?.plugins)) {
          nxJson.plugins.forEach((pluginEntry: any) => {
            const pluginName =
              typeof pluginEntry === "string" ? pluginEntry : pluginEntry?.plugin;
            if (typeof pluginName === "string") {
              const pkgName = pluginName.startsWith("@")
                ? pluginName.split("/").slice(0, 2).join("/")
                : pluginName.split("/")[0];
              if (pkgName) adapter.markPackageAsUsed(pkgName);
            }
          });
        }

        // Protect executors inside targetDefaults
        if (nxJson?.targetDefaults) {
          for (const targetConfig of Object.values<any>(nxJson.targetDefaults)) {
            if (targetConfig?.executor && typeof targetConfig.executor === "string") {
              const execPkg = targetConfig.executor.startsWith("@")
                ? targetConfig.executor.split("/").slice(0, 2).join("/")
                : targetConfig.executor.split("/")[0];
              if (execPkg) adapter.markPackageAsUsed(execPkg);
            }
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect project.json and Nx generator/plugin code
      if (basename === "project.json" || NX_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("nx");
      }

      if (normalized.includes("/generators/") || normalized.includes("/executors/")) {
        adapter.markAsUsed(fileId);
        adapter.markPackageAsUsed("@nx/devkit");
      }
    },

    onASTNode: (node, fileId, adapter) => {
      // Protect imports from @nx/* and nx/src/*
      if (t.isImportDeclaration(node)) {
        const source = node.source.value;
        if (source === "nx" || source.startsWith("@nx/")) {
          adapter.markPackageAsUsed(source);
          adapter.markAsUsed(fileId);
        }
      }
    }
  }
};

export default NxPlugin;