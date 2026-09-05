import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const UnpluginVueRouterPlugin: AnalyzerPlugin = {
  name: "unplugin-vue-router-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "unplugin-vue-router");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "unplugin-vue-router"))
        markDeclaredPackage(adapter, "unplugin-vue-router");
    },
  },
};

export default UnpluginVueRouterPlugin;
