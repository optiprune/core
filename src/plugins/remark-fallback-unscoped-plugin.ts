import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const RemarkFallbackUnscopedPlugin: AnalyzerPlugin = {
  name: "remark-fallback-unscoped-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "remark-fallback-unscoped");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "remark-fallback-unscoped"))
        markDeclaredPackage(adapter, "remark-fallback-unscoped");
    },
  },
};

export default RemarkFallbackUnscopedPlugin;
