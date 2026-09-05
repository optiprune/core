import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const LefthookCiPlugin: AnalyzerPlugin = {
  name: "lefthook-ci-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "lefthook-ci");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "lefthook-ci")) markDeclaredPackage(adapter, "lefthook-ci");
    },
  },
};

export default LefthookCiPlugin;
