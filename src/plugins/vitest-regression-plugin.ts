import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const VitestRegressionPlugin: AnalyzerPlugin = {
  name: "vitest-regression-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "vitest-regression");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "vitest-regression"))
        markDeclaredPackage(adapter, "vitest-regression");
    },
  },
};

export default VitestRegressionPlugin;
