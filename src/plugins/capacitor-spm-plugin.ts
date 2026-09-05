import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const CapacitorSpmPlugin: AnalyzerPlugin = {
  name: "capacitor-spm-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "capacitor-spm");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "capacitor-spm")) markDeclaredPackage(adapter, "capacitor-spm");
    },
  },
};

export default CapacitorSpmPlugin;
