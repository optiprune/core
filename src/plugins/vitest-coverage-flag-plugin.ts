import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const VitestCoverageFlagPlugin: AnalyzerPlugin = {
  name: "vitest-coverage-flag-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "vitest-coverage-flag");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "vitest-coverage-flag"))
        markDeclaredPackage(adapter, "vitest-coverage-flag");
    },
  },
};

export default VitestCoverageFlagPlugin;
