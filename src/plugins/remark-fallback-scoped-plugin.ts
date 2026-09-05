import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const RemarkFallbackScopedPlugin: AnalyzerPlugin = {
  name: "remark-fallback-scoped-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "remark-fallback-scoped");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "remark-fallback-scoped"))
        markDeclaredPackage(adapter, "remark-fallback-scoped");
    },
  },
};

export default RemarkFallbackScopedPlugin;
