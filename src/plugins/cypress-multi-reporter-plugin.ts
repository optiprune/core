import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const CypressMultiReporterPlugin: AnalyzerPlugin = {
  name: "cypress-multi-reporter-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "cypress-multi-reporter");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "cypress-multi-reporter"))
        markDeclaredPackage(adapter, "cypress-multi-reporter");
    },
  },
};

export default CypressMultiReporterPlugin;
