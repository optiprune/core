import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const VitepressConfigDirPlugin: AnalyzerPlugin = {
  name: "vitepress-config-dir-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "vitepress-config-dir");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "vitepress-config-dir"))
        markDeclaredPackage(adapter, "vitepress-config-dir");
    },
  },
};

export default VitepressConfigDirPlugin;
