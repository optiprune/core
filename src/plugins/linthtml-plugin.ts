import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const LinthtmlPlugin: AnalyzerPlugin = {
  name: "linthtml-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "linthtml");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "linthtml")) markDeclaredPackage(adapter, "linthtml");
    },
  },
};

export default LinthtmlPlugin;
