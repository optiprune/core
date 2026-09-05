import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const JestTransformPlugin: AnalyzerPlugin = {
  name: "jest-transform-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "jest-transform");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "jest-transform")) markDeclaredPackage(adapter, "jest-transform");
    },
  },
};

export default JestTransformPlugin;
