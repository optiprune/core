import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const TASKFILE_CONFIG_FILES = [
  "Taskfile.yml",
  "Taskfile.yaml",
  "Taskfile.dist.yml",
  "Taskfile.dist.yaml",
  "Taskfile.override.yml",
  "Taskfile.override.yaml",
];

export const TaskfilePlugin: AnalyzerPlugin = {
  name: "taskfile-plugin",
  version: "1.2.0",

  detect: async (adapter) => {
    // 1. Check for Taskfile configuration files
    for (const configFile of TASKFILE_CONFIG_FILES) {
      if (await adapter.folderExists(configFile)) return true;
    }

    // 2. Check package.json scripts for task or go-task CLI invocations
    const pkg = await adapter.readJson("package.json");
    if (pkg?.scripts) {
      const scriptValues = Object.values(pkg.scripts);
      if (
        scriptValues.some(
          (s) =>
            typeof s === "string" && (s.includes("task ") || s === "task" || s.includes("go-task")),
        )
      ) {
        return true;
      }
    }

    return false;
  },

  lifecycle: {
    onProjectInit: async (adapter) => {
      // 1. Mark existing Taskfile configuration files as active entry points
      for (const configFile of TASKFILE_CONFIG_FILES) {
        if (await adapter.folderExists(configFile)) {
          adapter.markConfigFileAsUsed(configFile);
        }
      }

      // 2. Track package.json npm scripts invoking Task CLI commands
      const pkg = await adapter.readJson("package.json");
      if (pkg?.scripts) {
        for (const [scriptName, scriptContent] of Object.entries(pkg.scripts)) {
          if (
            typeof scriptContent === "string" &&
            (scriptContent.includes("task ") ||
              scriptContent === "task" ||
              scriptContent.includes("go-task"))
          ) {
            adapter.markAsUsed("package.json", `scripts:${scriptName}`);
          }
        }
      }
    },

    onFileStart: (fileId, adapter) => {
      const normalized = fileId.replace(/\\/g, "/");
      const basename = path.basename(normalized);

      // Protect main Taskfile configs and sub-taskfiles (e.g. Taskfile_build.yml, Taskfile.dist.yaml)
      if (TASKFILE_CONFIG_FILES.includes(basename) || basename.startsWith("Taskfile")) {
        adapter.markConfigFileAsUsed(fileId);
      }
    },
  },
};

export default TaskfilePlugin;
