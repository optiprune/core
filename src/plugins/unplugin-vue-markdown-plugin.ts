import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const UnpluginVueMarkdownPlugin: AnalyzerPlugin = {
  name: "unplugin-vue-markdown-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "unplugin-vue-markdown");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "unplugin-vue-markdown"))
        markDeclaredPackage(adapter, "unplugin-vue-markdown");
    },
  },
};

export default UnpluginVueMarkdownPlugin;
