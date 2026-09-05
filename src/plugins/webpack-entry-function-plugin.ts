import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const WebpackEntryFunctionPlugin: AnalyzerPlugin = {
  name: "webpack-entry-function-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "webpack-entry-function");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "webpack-entry-function"))
        markDeclaredPackage(adapter, "webpack-entry-function");
    },
  },
};

export default WebpackEntryFunctionPlugin;
