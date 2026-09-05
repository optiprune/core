import type { AnalyzerPlugin } from "../types.js";
import { packageIsDeclared, markDeclaredPackage } from "./package-plugin-utils.js";

export const MarkdownlintPlugin: AnalyzerPlugin = {
  name: "markdownlint-plugin",
  version: "1.0.0",
  async detect(adapter) {
    return packageIsDeclared(await adapter.readJson("package.json"), "markdownlint");
  },
  lifecycle: {
    onProjectInit: async (adapter) => {
      const pkg = await adapter.readJson("package.json");
      if (packageIsDeclared(pkg, "markdownlint")) markDeclaredPackage(adapter, "markdownlint");
    },
  },
};

export default MarkdownlintPlugin;
