import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const CommitizenPlugin: AnalyzerPlugin = {
  name: "commitizen-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "commitizen");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "commitizen")) markDeclaredPackage(adapter, "commitizen");
    },
  },
};

export default CommitizenPlugin;
