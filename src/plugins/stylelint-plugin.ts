import { AnalyzerPlugin } from "../types.js";

const STYLELINT_FILES = [".stylelintrc", ".stylelintrc.json", ".stylelintrc.yaml", ".stylelintrc.js", "stylelint.config.js"];

export const StylelintPlugin: AnalyzerPlugin = {
  name: "stylelint-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["stylelint"] || pkg?.dependencies?.["stylelint"]);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (STYLELINT_FILES.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default StylelintPlugin;
