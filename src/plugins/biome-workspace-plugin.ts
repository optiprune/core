import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const BiomeWorkspacePlugin: AnalyzerPlugin = {
  name: "biome-workspace-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "biome-workspace");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "biome-workspace"))
        markDeclaredPackage(adapter, "biome-workspace");
    },
  },
};

export default BiomeWorkspacePlugin;
