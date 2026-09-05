import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const RemarkMissingPlaceholderPlugin: AnalyzerPlugin = {
  name: "remark-missing-placeholder-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "remark-missing-placeholder");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "remark-missing-placeholder"))
        markDeclaredPackage(adapter, "remark-missing-placeholder");
    },
  },
};

export default RemarkMissingPlaceholderPlugin;
