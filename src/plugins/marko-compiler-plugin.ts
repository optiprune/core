import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const MarkoCompilerPlugin: AnalyzerPlugin = {
  name: "marko-compiler-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "marko-compiler");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "marko-compiler")) markDeclaredPackage(adapter, "marko-compiler");
    },
  },
};

export default MarkoCompilerPlugin;
