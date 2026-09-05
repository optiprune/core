import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const WebpackCliPlugin: AnalyzerPlugin = {
  name: "webpack-cli-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "webpack-cli");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "webpack-cli")) markDeclaredPackage(adapter, "webpack-cli");
    },
  },
};

export default WebpackCliPlugin;
