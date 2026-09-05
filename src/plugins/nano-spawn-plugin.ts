import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const NanoSpawnPlugin: AnalyzerPlugin = {
  name: "nano-spawn-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "nano-spawn");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "nano-spawn")) markDeclaredPackage(adapter, "nano-spawn");
    },
  },
};

export default NanoSpawnPlugin;
