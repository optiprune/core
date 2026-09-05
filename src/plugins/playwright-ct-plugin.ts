import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const PlaywrightCtPlugin: AnalyzerPlugin = {
  name: "playwright-ct-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "playwright-ct");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "playwright-ct")) markDeclaredPackage(adapter, "playwright-ct");
    },
  },
};

export default PlaywrightCtPlugin;
