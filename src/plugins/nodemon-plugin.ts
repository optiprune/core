import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const NodemonPlugin: AnalyzerPlugin = {
  name: "nodemon-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "nodemon");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "nodemon")) markDeclaredPackage(adapter, "nodemon");
    },
  },
};

export default NodemonPlugin;
