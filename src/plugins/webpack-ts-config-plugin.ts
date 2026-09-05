import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const WebpackTsConfigPlugin: AnalyzerPlugin = {
  name: "webpack-ts-config-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "webpack-ts-config");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "webpack-ts-config"))
        markDeclaredPackage(adapter, "webpack-ts-config");
    },
  },
};

export default WebpackTsConfigPlugin;
