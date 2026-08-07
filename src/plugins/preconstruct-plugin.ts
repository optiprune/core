import { AnalyzerPlugin } from "../types.js";

export const PreconstructPlugin: AnalyzerPlugin = {
  name: "preconstruct-plugin",
  version: "1.0.0",
  detect: async (adapter) => {
    const pkg = await adapter.readJson("package.json");
    return !!(pkg?.devDependencies?.["@preconstruct/cli"] || pkg?.preconstruct);
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (pkg?.preconstruct) {
        adapter.markAsUsed("package.json", "preconstruct");
      }
    }
  }
};

export default PreconstructPlugin;
