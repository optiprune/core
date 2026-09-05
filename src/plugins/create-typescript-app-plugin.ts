import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const CreateTypescriptAppPlugin: AnalyzerPlugin = {
  name: "create-typescript-app-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "create-typescript-app");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "create-typescript-app"))
        markDeclaredPackage(adapter, "create-typescript-app");
    },
  },
};

export default CreateTypescriptAppPlugin;
