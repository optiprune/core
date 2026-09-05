import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const SyncpackPlugin: AnalyzerPlugin = {
  name: "syncpack-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "syncpack");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "syncpack")) markDeclaredPackage(adapter, "syncpack");
    },
  },
};

export default SyncpackPlugin;
