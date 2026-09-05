import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const RemarkPrimaryUnscopedPlugin: AnalyzerPlugin = {
  name: "remark-primary-unscoped-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "remark-primary-unscoped");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "remark-primary-unscoped"))
        markDeclaredPackage(adapter, "remark-primary-unscoped");
    },
  },
};

export default RemarkPrimaryUnscopedPlugin;
