import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const PostcssCjsPlugin: AnalyzerPlugin = {
  name: "postcss-cjs-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "postcss-cjs");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "postcss-cjs")) markDeclaredPackage(adapter, "postcss-cjs");
    },
  },
};

export default PostcssCjsPlugin;
