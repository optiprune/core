import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const AstroDbPlugin: AnalyzerPlugin = {
  name: "astro-db-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "astro-db");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "astro-db")) markDeclaredPackage(adapter, "astro-db");
    },
  },
};

export default AstroDbPlugin;
