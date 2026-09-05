import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const HuskyLegacyPlugin: AnalyzerPlugin = {
  name: "husky-legacy-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "husky-legacy");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "husky-legacy")) markDeclaredPackage(adapter, "husky-legacy");
    },
  },
};

export default HuskyLegacyPlugin;
