import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const VercelOgPlugin: AnalyzerPlugin = {
  name: "vercel-og-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "vercel-og");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "vercel-og")) markDeclaredPackage(adapter, "vercel-og");
    },
  },
};

export default VercelOgPlugin;
