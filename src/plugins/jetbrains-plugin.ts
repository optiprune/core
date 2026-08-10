import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const JETBRAINS_FILES = [
  ".idea",
  "workspace.xml",
  "modules.xml",
  "runConfigurations",
  "externalDependencies.xml"
];

export const JetBrainsPlugin: AnalyzerPlugin = {
  name: "jetbrains-plugin",
  version: "1.0.0",

  detect: async (adapter) => {
    return await adapter.folderExists(".idea");
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      const hasIdeaDir = await adapter.folderExists(".idea");
      if (!hasIdeaDir) return;

      // 1. Mark .idea directory and core config files as used
      adapter.markAsUsed(".idea");

      // 2. Inspect Run Configurations (.idea/runConfigurations/*.xml)
      // These XML files contain run/debug entries for scripts, apps, and npm commands.
      const runConfigsDir = ".idea/runConfigurations";
      if (await adapter.folderExists(runConfigsDir)) {
        adapter.markAsUsed(runConfigsDir);

        // We can inspect common XML tags inside run configuration files
        // e.g. <option name="SCRIPT_NAME" value="$PROJECT_DIR$/src/index.ts" />
        // or <option name="COMMAND" value="run build" />
      }

      // 3. Inspect External Dependencies (.idea/externalDependencies.xml)
      const extDepsContent = await adapter.readFile(".idea/externalDependencies.xml");
      if (extDepsContent) {
        adapter.markAsUsed(".idea/externalDependencies.xml");

        // Extract plugin or tool dependency names declared for the workspace
        const pluginMatch = /<plugin\s+id=["']([^"']+)["']/g;
        let match: RegExpExecArray | null;
        while ((match = pluginMatch.exec(extDepsContent)) !== null) {
          if (match[1]) {
            adapter.markPackageAsUsed(match[1]);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");

      // Automatically mark files inside .idea/ as used (excluding workspace.xml volatile local state)
      if (normalized.includes(".idea/")) {
        if (!normalized.endsWith(".idea/workspace.xml") && !normalized.includes(".idea/shelf/")) {
          adapter.markAsUsed(fileId);
        }
      }

      // Mark legacy file-based project configuration (.iml, .ipr, .iws)
      if (normalized.endsWith(".iml") || normalized.endsWith(".ipr")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default JetBrainsPlugin;