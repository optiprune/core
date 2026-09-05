import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const LefthookYamlPlugin: AnalyzerPlugin = {
  name: "lefthook-yaml-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "lefthook-yaml");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "lefthook-yaml")) markDeclaredPackage(adapter, "lefthook-yaml");
    },
  },
};

export default LefthookYamlPlugin;
