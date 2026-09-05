import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const AstroOgCanvasPlugin: AnalyzerPlugin = {
  name: "astro-og-canvas-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "astro-og-canvas");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "astro-og-canvas"))
        markDeclaredPackage(adapter, "astro-og-canvas");
    },
  },
};

export default AstroOgCanvasPlugin;
