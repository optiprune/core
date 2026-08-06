import { AnalyzerPlugin } from "../types.js";

const POSTCSS_FILES = ["postcss.config.js", "postcss.config.cjs", "postcss.config.mjs"];

export const PostCSSPlugin: AnalyzerPlugin = {
  name: "postcss-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["postcss"] || pkg?.dependencies?.["postcss"]);
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      if (POSTCSS_FILES.some(pattern => fileId.endsWith(pattern))) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default PostCSSPlugin;
