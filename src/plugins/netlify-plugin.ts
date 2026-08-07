import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const NETLIFY_CONFIG_FILES = ["netlify.toml"];

export const NetlifyPlugin: AnalyzerPlugin = {
  name: "netlify-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.devDependencies?.["netlify-cli"] || pkg.dependencies?.["netlify-cli"])) {
      return true;
    }
    for (const file of NETLIFY_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (NETLIFY_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      // Netlify Functions
      if (fileId.includes("/netlify/functions/") || fileId.includes("/functions/")) {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default NetlifyPlugin;
