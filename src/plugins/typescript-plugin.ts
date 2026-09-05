import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const TypescriptPlugin: AnalyzerPlugin = {
  name: "typescript-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "typescript");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "typescript")) markDeclaredPackage(adapter, "typescript");
    },
  },
};

export default TypescriptPlugin;
