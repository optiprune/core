import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const UnpluginVueComponentsPlugin: AnalyzerPlugin = {
  name: "unplugin-vue-components-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "unplugin-vue-components");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "unplugin-vue-components"))
        markDeclaredPackage(adapter, "unplugin-vue-components");
    },
  },
};

export default UnpluginVueComponentsPlugin;
