import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const NodeTestRunnerNubPlugin: AnalyzerPlugin = {
  name: "node-test-runner-nub-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "node-test-runner-nub");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "node-test-runner-nub"))
        markDeclaredPackage(adapter, "node-test-runner-nub");
    },
  },
};

export default NodeTestRunnerNubPlugin;
