import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const NxCrystalPlugin: AnalyzerPlugin = {
  name: "nx-crystal-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "nx-crystal");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "nx-crystal")) markDeclaredPackage(adapter, "nx-crystal");
    },
  },
};

export default NxCrystalPlugin;
