import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const ConvexCustomFunctionsPlugin: AnalyzerPlugin = {
  name: "convex-custom-functions-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "convex-custom-functions");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "convex-custom-functions"))
        markDeclaredPackage(adapter, "convex-custom-functions");
    },
  },
};

export default ConvexCustomFunctionsPlugin;
