import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const UnpluginVueI18nPlugin: AnalyzerPlugin = {
  name: "unplugin-vue-i18n-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "unplugin-vue-i18n");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "unplugin-vue-i18n"))
        markDeclaredPackage(adapter, "unplugin-vue-i18n");
    },
  },
};

export default UnpluginVueI18nPlugin;
