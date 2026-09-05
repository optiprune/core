import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const WebpackEntryImportPlugin: AnalyzerPlugin = {
  name: "webpack-entry-import-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "webpack-entry-import");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "webpack-entry-import"))
        markDeclaredPackage(adapter, "webpack-entry-import");
    },
  },
};

export default WebpackEntryImportPlugin;
