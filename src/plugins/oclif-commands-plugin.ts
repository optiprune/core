import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const OclifCommandsPlugin: AnalyzerPlugin = {
  name: "oclif-commands-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "oclif-commands");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "oclif-commands")) markDeclaredPackage(adapter, "oclif-commands");
    },
  },
};

export default OclifCommandsPlugin;
