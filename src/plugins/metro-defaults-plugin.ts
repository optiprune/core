import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const MetroDefaultsPlugin: AnalyzerPlugin = {
  name: "metro-defaults-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "metro-defaults");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "metro-defaults")) markDeclaredPackage(adapter, "metro-defaults");
    },
  },
};

export default MetroDefaultsPlugin;
