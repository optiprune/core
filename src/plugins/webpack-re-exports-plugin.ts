import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const WebpackReExportsPlugin: AnalyzerPlugin = {
  name: "webpack-re-exports-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "webpack-re-exports");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "webpack-re-exports"))
        markDeclaredPackage(adapter, "webpack-re-exports");
    },
  },
};

export default WebpackReExportsPlugin;
