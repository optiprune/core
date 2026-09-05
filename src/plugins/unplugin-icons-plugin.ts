import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const UnpluginIconsPlugin: AnalyzerPlugin = {
  name: "unplugin-icons-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "unplugin-icons");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "unplugin-icons")) markDeclaredPackage(adapter, "unplugin-icons");
    },
  },
};

export default UnpluginIconsPlugin;
