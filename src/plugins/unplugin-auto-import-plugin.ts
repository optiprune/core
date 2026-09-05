import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const UnpluginAutoImportPlugin: AnalyzerPlugin = {
  name: "unplugin-auto-import-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "unplugin-auto-import");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "unplugin-auto-import"))
        markDeclaredPackage(adapter, "unplugin-auto-import");
    },
  },
};

export default UnpluginAutoImportPlugin;
