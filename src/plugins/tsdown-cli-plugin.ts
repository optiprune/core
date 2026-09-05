import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const TsdownCliPlugin: AnalyzerPlugin = {
  name: "tsdown-cli-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "tsdown-cli");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "tsdown-cli")) markDeclaredPackage(adapter, "tsdown-cli");
    },
  },
};

export default TsdownCliPlugin;
