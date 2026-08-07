import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

const METRO_CONFIG_FILES = ["metro.config.js", "metro.config.cjs", "metro.config.json"];

export const MetroPlugin: AnalyzerPlugin = {
  name: "metro-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    if (pkg && (pkg.dependencies?.["metro"] || pkg.devDependencies?.["metro"] || pkg.dependencies?.["react-native"])) {
      return true;
    }
    for (const file of METRO_CONFIG_FILES) {
      if ((await adapter.readFile(file)) !== null) return true;
    }
    return false;
  },
  lifecycle: {
    onFileStart: (fileId, adapter) => {
      const basename = path.basename(fileId);
      if (METRO_CONFIG_FILES.includes(basename)) {
        adapter.markAsUsed(fileId);
      }
      // React Native entry points
      if (basename === "index.js" || basename === "App.js" || basename === "App.tsx") {
        adapter.markAsUsed(fileId);
      }
    }
  }
};

export default MetroPlugin;
