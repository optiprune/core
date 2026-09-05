import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const PrettierReExportsPlugin: AnalyzerPlugin = {
  name: "prettier-re-exports-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "prettier-re-exports");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "prettier-re-exports"))
        markDeclaredPackage(adapter, "prettier-re-exports");
    },
  },
};

export default PrettierReExportsPlugin;
