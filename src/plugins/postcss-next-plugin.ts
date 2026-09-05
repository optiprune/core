import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const PostcssNextPlugin: AnalyzerPlugin = {
  name: "postcss-next-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "postcss-next");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "postcss-next")) markDeclaredPackage(adapter, "postcss-next");
    },
  },
};

export default PostcssNextPlugin;
