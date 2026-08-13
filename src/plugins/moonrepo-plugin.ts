import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const MOON_WORKSPACE_FILES = [
  ".moon/workspace.yml",
  ".moon/workspace.yaml",
  ".moon/toolchain.yml",
  ".moon/toolchain.yaml",
  ".moon/tasks.yml",
  ".moon/tasks.yaml"
];

const MOON_PACKAGES = ["@moonrepo/cli", "@moonrepo/types"];

export const MoonrepoPlugin: AnalyzerPlugin = {
  name: "moonrepo-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg) {
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (MOON_PACKAGES.some((p) => p in allDeps)) return true;
    }

    for (const configFile of MOON_WORKSPACE_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    return (
      (await adapter.folderExists(".moon")) ||
      (await adapter.folderExists("moon.yml")) ||
      (await adapter.folderExists("moon.yaml"))
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

      // 1. Mark workspace config files and .moon/ folder as used
      for (const configFile of MOON_WORKSPACE_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markAsUsed(configFile);
        }
      }

      if (await adapter.folderExists(".moon")) {
        adapter.markAsUsed(".moon");
      }

      // 2. Protect installed @moonrepo/* packages
      // Do not treat a manifest entry as usage evidence.

      // 3. Inspect package.json scripts for moon execution (e.g. "build": "moon run :build")
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (typeof scriptContent === "string" && scriptContent.includes("moon ")) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }

      // 4. Scan .moon/tasks.yml or project-level moon.yml for CLI tools and scripts
      const tasksContent =
        (await adapter.readFile(".moon/tasks.yml")) ||
        (await adapter.readFile(".moon/tasks.yaml"));

      if (tasksContent) {
        // Extract command executions (e.g., command: "eslint .", command: "vite build")
        const commandMatches = tasksContent.matchAll(/command:\s*["']?([^"'\n\r]+)["']?/g);
        for (const match of commandMatches) {
          const rawCmd = match[1]?.trim();
          if (!rawCmd) continue;

          const tokens = rawCmd.split(/\s+/).filter((t) => t.length > 0);
          const firstToken = tokens[0];

          if (firstToken && !firstToken.startsWith("-")) {
            // Protect script/CLI package (e.g. vite, eslint, tsc, vitest)
            adapter.markPackageAsUsed(firstToken);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect moon.yml project configs and files under .moon/
      if (
        basename === "moon.yml" ||
        basename === "moon.yaml" ||
        normalized.includes(".moon/")
      ) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default MoonrepoPlugin;