import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const OxlintViteConfigPlugin: AnalyzerPlugin = {
  name: "oxlint-vite-config-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "oxlint-vite-config");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "oxlint-vite-config"))
        markDeclaredPackage(adapter, "oxlint-vite-config");
    },
  },
};

export default OxlintViteConfigPlugin;
