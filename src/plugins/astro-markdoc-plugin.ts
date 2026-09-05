import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const AstroMarkdocPlugin: AnalyzerPlugin = {
  name: "astro-markdoc-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "astro-markdoc");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "astro-markdoc")) markDeclaredPackage(adapter, "astro-markdoc");
    },
  },
};

export default AstroMarkdocPlugin;
