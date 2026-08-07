import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

export const TravisCiPlugin: AnalyzerPlugin = {
  name: "travis-ci-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const hasConfig = (await adapter.readFile(".travis.yml")) !== null;
    return hasConfig;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (basename === ".travis.yml") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default TravisCiPlugin;
