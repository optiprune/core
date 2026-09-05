import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const NanoStagedPlugin: AnalyzerPlugin = {
  name: "nano-staged-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "nano-staged");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "nano-staged")) markDeclaredPackage(adapter, "nano-staged");
    },
  },
};

export default NanoStagedPlugin;
