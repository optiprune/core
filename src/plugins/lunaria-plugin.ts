import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const LunariaPlugin: AnalyzerPlugin = {
  name: "lunaria-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "lunaria");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "lunaria")) markDeclaredPackage(adapter, "lunaria");
    },
  },
};

export default LunariaPlugin;
