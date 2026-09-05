import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const RemarkLocalPathPlugin: AnalyzerPlugin = {
  name: "remark-local-path-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "remark-local-path");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "remark-local-path"))
        markDeclaredPackage(adapter, "remark-local-path");
    },
  },
};

export default RemarkLocalPathPlugin;
