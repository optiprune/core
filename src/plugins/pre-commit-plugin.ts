import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

export const PreCommitPlugin: AnalyzerPlugin = {
  name: "pre-commit-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const hasConfig = (await adapter.readFile(".pre-commit-config.yaml")) !== null;
    return hasConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (basename === ".pre-commit-config.yaml") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default PreCommitPlugin;
