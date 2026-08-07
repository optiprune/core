import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const TASKFILE_CONFIG_FILES = ["Taskfile.yml", "Taskfile.yaml"];

export const TaskfilePlugin: AnalyzerPlugin = {
  name: "taskfile-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    for (const file of TASKFILE_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (TASKFILE_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default TaskfilePlugin;
