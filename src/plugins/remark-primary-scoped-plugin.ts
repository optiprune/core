import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const RemarkPrimaryScopedPlugin: AnalyzerPlugin = {
  name: "remark-primary-scoped-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "remark-primary-scoped");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "remark-primary-scoped"))
        markDeclaredPackage(adapter, "remark-primary-scoped");
    },
  },
};

export default RemarkPrimaryScopedPlugin;
