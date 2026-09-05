import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const VitestNpmScriptPlugin: AnalyzerPlugin = {
  name: "vitest-npm-script-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "vitest-npm-script");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "vitest-npm-script"))
        markDeclaredPackage(adapter, "vitest-npm-script");
    },
  },
};

export default VitestNpmScriptPlugin;
