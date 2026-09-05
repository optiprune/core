import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const AstroSharpImageServicePlugin: AnalyzerPlugin = {
  name: "astro-sharp-image-service-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "astro-sharp-image-service");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "astro-sharp-image-service"))
        markDeclaredPackage(adapter, "astro-sharp-image-service");
    },
  },
};

export default AstroSharpImageServicePlugin;
