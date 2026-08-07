import { AnalyzerPlugin } from "../types.js";
import path from "pathe";

export const TsxPlugin: AnalyzerPlugin = {
  name: "tsx-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["tsx"] || pkg?.dependencies?.["tsx"]);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (pkg?.scripts) {
        for (const script of Object.values(pkg.scripts)) {
          if (typeof script === "string" && script.includes("tsx ")) {
            // Mark the file used in the script as an entry point
            const match = script.match(/tsx\s+([^\s]+\.[jt]sx?)/);
            if (match && match[1]) {
              adapter.markAsUsed(path.resolve(adapter.getConfig().rootDir, match[1]));
            }
          }
        }
      }
    }
  }
};

export default TsxPlugin;
