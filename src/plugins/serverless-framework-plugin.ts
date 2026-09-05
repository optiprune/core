import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const ServerlessFrameworkPlugin: AnalyzerPlugin = {
  name: "serverless-framework-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "serverless-framework");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "serverless-framework"))
        markDeclaredPackage(adapter, "serverless-framework");
    },
  },
};

export default ServerlessFrameworkPlugin;
