import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const NuxtjsI18nPlugin: AnalyzerPlugin = {
  name: "nuxtjs-i18n-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "nuxtjs-i18n");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "nuxtjs-i18n")) markDeclaredPackage(adapter, "nuxtjs-i18n");
    },
  },
};

export default NuxtjsI18nPlugin;
